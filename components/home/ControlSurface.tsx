'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  COLORS,
  STAGE_STYLES,
  getDaysColor,
  FONTS,
} from '@/lib/design-system';
import {
  evaluateModulePriority,
  isNeedsAttention,
  scoreDealRelevance,
  scoreAttentionUrgency,
  type ModulePriorityResult,
} from '@/lib/module-priority';
import type { DealRow, MeetingRow, UserDomainProfile } from '@/lib/types';
import {
  DEFAULT_DOMAIN_PROFILE,
  getControlSurfaceLabels,
} from '@/lib/semantic-labels';
import { useSurface } from '@/components/surfaces/SurfaceManager';
import { useMeetingStore } from '@/lib/meeting-store';
import { useMeetingActions } from '@/lib/meeting-actions';
import { useTaskEngine } from '@/lib/task-engine';
import type { TaskAction } from '@/lib/task-types';
import { useWhatMattersTasks, markTaskDone, skipTask, type DisplayTask } from '@/lib/task-queries';
import RescheduleSheet from '@/components/meetings/RescheduleSheet';
import MeetingActionToast from '@/components/meetings/MeetingActionToast';

// ── TYPES ──────────────────────────────────────────────────
type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface ControlSurfaceProps {
  open: boolean;
  onClose: () => void;
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
  domainProfile?: UserDomainProfile;
  /** Session 11C: User ID for persistent task reads. */
  userId?: string | null;
}

// ── HELPERS ────────────────────────────────────────────────
function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatMeetingTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const h12 = h % 12 || 12;
  const ap = h < 12 ? 'am' : 'pm';
  const timeStr = `${h12}:${m}${ap}`;

  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${timeStr}`;
}

function formatDealValue(value: number | null, valueType?: string): string {
  if (!value) return '';
  const fmt = value >= 1000
    ? `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
    : `$${value}`;
  if (valueType === 'mrr') return `${fmt}/mo`;
  if (valueType === 'arr') return `${fmt}/yr`;
  return fmt;
}

function minutesUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60);
}

// ── COMPONENT ──────────────────────────────────────────────
export default function ControlSurface({
  open,
  onClose,
  allDeals,
  urgentDeals,
  meetings,
  domainProfile,
  userId,
}: ControlSurfaceProps) {
  const { navigateTo } = useSurface();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [everythingElseOpen, setEverythingElseOpen] = useState(false);
  const labels = useMemo(
    () => getControlSurfaceLabels(domainProfile ?? DEFAULT_DOMAIN_PROFILE),
    [domainProfile],
  );

  // Animate in/out
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSheetVisible(true);
        });
      });
    } else {
      setSheetVisible(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setSheetVisible(false);
    setTimeout(onClose, 340);
  }, [onClose]);

  const openSurface = useCallback((surfaceId: string, params?: Record<string, string>) => {
    handleClose();
    setTimeout(() => navigateTo(surfaceId as import('@/components/surfaces/SurfaceManager').SurfaceId, params), 200);
  }, [handleClose, navigateTo]);

  // ── SESSION 8: Meeting actions ──
  const { completeMeeting, cancelMeeting, rescheduleMeeting } = useMeetingActions();
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    meetingId: string;
    title: string;
    startTime: number;
  } | null>(null);

  const handleRescheduleOpen = useCallback((meetingId: string) => {
    const storeMeeting = useMeetingStore.getState().getMeetingById(meetingId);
    const meetingRow = meetings.find(m => m.id === meetingId);
    const title = storeMeeting?.title ?? meetingRow?.title ?? 'Meeting';
    const startTime = storeMeeting?.startTime ?? (meetingRow ? new Date(meetingRow.scheduled_at).getTime() : Date.now());
    setRescheduleTarget({ meetingId, title, startTime });
  }, [meetings]);

  const handleRescheduleConfirm = useCallback((newTime: number) => {
    if (!rescheduleTarget) return;
    rescheduleMeeting(rescheduleTarget.meetingId, newTime);
    setRescheduleTarget(null);
  }, [rescheduleTarget, rescheduleMeeting]);

  // ── SESSION 9: System-derived task engine (legacy fallback) ──
  const legacySystemTasks = useTaskEngine(allDeals);

  // ── SESSION 11C: Persistent task reads from DB ──
  const { tasks: dbTasks, loading: dbTasksLoading, refetch: refetchTasks } = useWhatMattersTasks(userId ?? null, 5);

  // ── SESSION 11C: Unified task list — DB primary, legacy fallback ──
  // If DB has tasks, use them. If DB is empty/loading but legacy has tasks, show legacy.
  // This prevents blank "What Matters" during migration.
  const [taskActionPending, setTaskActionPending] = useState<string | null>(null);

  const { unifiedTasks, usingFallback } = useMemo(() => {
    // DB tasks available and non-empty → use them
    if (!dbTasksLoading && dbTasks.length > 0) {
      return { unifiedTasks: dbTasks, usingFallback: false };
    }
    // DB still loading → show legacy as temporary bridge
    if (dbTasksLoading && legacySystemTasks.length > 0) {
      return { unifiedTasks: null, usingFallback: true };
    }
    // DB loaded but empty, legacy has tasks → fallback
    if (!dbTasksLoading && dbTasks.length === 0 && legacySystemTasks.length > 0) {
      return { unifiedTasks: null, usingFallback: true };
    }
    // Both empty → nothing
    return { unifiedTasks: dbTasks, usingFallback: false };
  }, [dbTasks, dbTasksLoading, legacySystemTasks]);

  // Combined task count for module priority
  const effectiveTaskCount = usingFallback
    ? legacySystemTasks.length
    : (unifiedTasks?.length ?? 0);

  // ── SESSION 9: Task action handler ──
  // IMPORTANT: All hooks must be called before the early return below.
  const handleTaskAction = useCallback((action: TaskAction) => {
    switch (action.kind) {
      case 'open_prep':
        if (action.dealId) {
          openSurface('deal-prep', { dealId: action.dealId });
        } else {
          openSurface('briefing');
        }
        break;
      case 'open_chat':
        if (action.dealId) {
          openSurface('deal-chat', { dealId: action.dealId });
        } else {
          openSurface('briefing');
        }
        break;
      case 'open_deal':
        openSurface('deal-detail', { dealId: action.dealId });
        break;
      case 'open_briefing':
        openSurface('briefing');
        break;
    }
  }, [openSurface]);

  // ── ADAPTIVE MODULE PRIORITY ────────────────────────────
  // Session 11C: Use effective task count (DB primary, legacy fallback)
  const priority = useMemo<ModulePriorityResult>(() => {
    return evaluateModulePriority({ allDeals, urgentDeals, meetings, systemTaskCount: effectiveTaskCount });
  }, [allDeals, urgentDeals, meetings, effectiveTaskCount]);

  // ── Session 7: Meeting store for status-aware filtering ──
  const meetingStoreData = useMeetingStore(state => state.meetings);

  // ── PREPARED DATA (sorted by relevance) ─────────────────
  const preparedData = useMemo(() => {
    const now = new Date();

    // Attention items: ranked by urgency score
    const attentionCandidates = urgentDeals.length > 0
      ? urgentDeals
      : allDeals.filter(isNeedsAttention);
    const attentionItems = [...attentionCandidates]
      .sort((a, b) => scoreAttentionUrgency(b) - scoreAttentionUrgency(a))
      .slice(0, 4);

    // Top deals: ranked by relevance score, excluding closed
    const topDeals = allDeals
      .filter(d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost')
      .sort((a, b) => scoreDealRelevance(b) - scoreDealRelevance(a))
      .slice(0, 5);

    // Session 7: Upcoming meetings — filter through store status.
    const upcomingMeetings = meetings
      .filter(m => {
        const storeMeeting = meetingStoreData[m.id];
        if (storeMeeting) {
          return storeMeeting.status === 'scheduled' && storeMeeting.startTime >= now.getTime() - 2 * 60 * 60 * 1000;
        }
        return new Date(m.scheduled_at) >= now;
      })
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, 3);

    const cancelledMeetings = Object.values(meetingStoreData)
      .filter(m => m.status === 'cancelled')
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);

    const completedMeetings = Object.values(meetingStoreData)
      .filter(m => m.status === 'completed')
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);

    return { attentionItems, topDeals, upcomingMeetings, cancelledMeetings, completedMeetings };
  }, [allDeals, urgentDeals, meetings, meetingStoreData]);

  // ── ALL HOOKS ABOVE THIS LINE ───────────────────────────
  if (!open) return null;

  const { attentionItems, topDeals, upcomingMeetings } = preparedData;
  const { isLowDataState } = priority;

  // ── SESSION 10: TASK ACCENT STYLES ─────────────────────
  const TASK_ACCENT: Record<string, { color: string; bg: string; border: string }> = {
    meeting_prep: {
      color: COLORS.amber,
      bg: 'rgba(232,160,48,0.08)',
      border: 'rgba(232,160,48,0.16)',
    },
    meeting_followup: {
      color: COLORS.teal,
      bg: 'rgba(56,184,200,0.08)',
      border: 'rgba(56,184,200,0.16)',
    },
    deal_next_step: {
      color: 'rgba(240,235,224,0.60)',
      bg: 'rgba(240,235,224,0.04)',
      border: 'rgba(240,235,224,0.10)',
    },
    reengage: {
      color: COLORS.red,
      bg: 'rgba(224,88,64,0.06)',
      border: 'rgba(224,88,64,0.14)',
    },
  };

  // ── SESSION 11C: "WHAT MATTERS" — unified persistent + fallback ──
  const whatMattersItems = effectiveTaskCount > 0 || attentionItems.length > 0;

  // ── SESSION 11C: Helpers for persistent task display ──
  // Resolve accent for a DisplayTask (no source_type jargon in UI)
  const getTaskAccent = (task: DisplayTask) => {
    if (task.sourceType && TASK_ACCENT[task.sourceType]) return TASK_ACCENT[task.sourceType];
    // User-created tasks get a neutral accent
    return {
      color: 'rgba(240,235,224,0.60)',
      bg: 'rgba(240,235,224,0.04)',
      border: 'rgba(240,235,224,0.10)',
    };
  };

  // Format due_at for display
  const formatDueAt = (dueAt: string | null): string | null => {
    if (!dueAt) return null;
    const d = new Date(dueAt);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 0) return 'overdue';
    if (diffMin < 60) return `in ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `in ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 0) return 'today';
    if (diffD === 1) return 'tomorrow';
    return `in ${diffD}d`;
  };

  // Handle task done/skip with optimistic UI
  const handleTaskDone = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskActionPending(taskId);
    const ok = await markTaskDone(taskId);
    setTaskActionPending(null);
    if (ok) refetchTasks();
  }, [refetchTasks]);

  const handleTaskSkip = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskActionPending(taskId);
    const ok = await skipTask(taskId);
    setTaskActionPending(null);
    if (ok) refetchTasks();
  }, [refetchTasks]);

  // ── Render a single persistent task row (Session 11C) ──
  const renderPersistentTaskRow = (task: DisplayTask) => {
    const accent = getTaskAccent(task);
    const timeLabel = formatDueAt(task.dueAt);
    const isPending = taskActionPending === task.id;

    return (
      <div
        key={task.id}
        onClick={() => task.action ? handleTaskAction(task.action) : undefined}
        style={{
          background: accent.bg,
          border: `0.5px solid ${accent.border}`,
          borderRadius: 12,
          padding: '13px 14px',
          cursor: task.action ? 'pointer' : 'default',
          transition: 'border-color 0.15s ease, opacity 0.2s ease',
          opacity: isPending ? 0.4 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: 'rgba(252,246,234,0.88)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {task.title}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10, flexShrink: 0 }}>
            {timeLabel && (
              <span style={{ fontSize: 11, fontWeight: 500, color: accent.color }}>
                {timeLabel}
              </span>
            )}
            {/* Minimal actions: Done + Dismiss */}
            <button
              onClick={(e) => handleTaskDone(task.id, e)}
              disabled={isPending}
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                border: '0.5px solid rgba(72,200,120,0.25)',
                background: 'rgba(72,200,120,0.08)',
                color: COLORS.green,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
                lineHeight: '1.3',
              }}
            >
              Done
            </button>
            <button
              onClick={(e) => handleTaskSkip(task.id, e)}
              disabled={isPending}
              style={{
                padding: '3px 6px',
                borderRadius: 6,
                border: '0.5px solid rgba(240,235,224,0.10)',
                background: 'rgba(240,235,224,0.03)',
                color: 'rgba(240,235,224,0.32)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
                lineHeight: '1.3',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render a single legacy system task row (unchanged from Session 10) ──
  const renderLegacyTaskRow = (task: typeof legacySystemTasks[number]) => {
    const accent = TASK_ACCENT[task.type] ?? TASK_ACCENT.deal_next_step;
    return (
      <div
        key={task.id}
        onClick={() => handleTaskAction(task.action)}
        style={{
          background: accent.bg,
          border: `0.5px solid ${accent.border}`,
          borderRadius: 12,
          padding: '13px 14px',
          cursor: 'pointer',
          transition: 'border-color 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: 'rgba(252,246,234,0.88)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {task.title}
          </span>
          {task.timeRelevance && (
            <span style={{ fontSize: 11, fontWeight: 500, color: accent.color, marginLeft: 10, flexShrink: 0 }}>
              {task.timeRelevance}
            </span>
          )}
        </div>
        {task.subtitle && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 300,
              color: 'rgba(240,235,224,0.38)',
              marginTop: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {task.subtitle}
          </div>
        )}
      </div>
    );
  };

  const renderWhatMatters = () => {
    if (!whatMattersItems) return null;

    // Determine task slots used (max 5 total including attention items)
    const taskSlots = usingFallback
      ? legacySystemTasks.slice(0, 5)
      : (unifiedTasks ?? []).slice(0, 5);
    const taskSlotsUsed = taskSlots.length;
    const attentionSlots = taskSlotsUsed < 5
      ? attentionItems.slice(0, 5 - taskSlotsUsed)
      : [];

    return (
      <div key="what_matters" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '1.4px',
            color: COLORS.amber,
            marginBottom: 10,
            paddingLeft: 2,
          }}
        >
          {labels.whatMatters}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Tasks: DB-backed or legacy fallback */}
          {usingFallback
            ? legacySystemTasks.slice(0, 5).map(renderLegacyTaskRow)
            : (unifiedTasks ?? []).slice(0, 5).map(renderPersistentTaskRow)
          }

          {/* Attention items — only if space remains under 5 total */}
          {attentionSlots.map((deal) => {
            const days = getDaysSince(deal.last_activity_at);
            return (
              <div
                key={deal.id}
                onClick={() => openSurface('deal-detail', { dealId: deal.id })}
                style={{
                  background: 'rgba(232,160,48,0.06)',
                  border: '0.5px solid rgba(232,160,48,0.12)',
                  borderRadius: 12,
                  padding: '11px 14px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: 'rgba(252,246,234,0.88)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {deal.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: getDaysColor(days),
                      marginLeft: 10,
                      flexShrink: 0,
                    }}
                  >
                    {days}d ago
                  </span>
                </div>
                {deal.next_action && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 300,
                      color: 'rgba(240,235,224,0.42)',
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {deal.next_action}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── SESSION 10: "COMING UP" ─────────────────────────────
  const renderComingUp = () => {
    if (upcomingMeetings.length === 0) return null;

    return (
      <div key="coming_up" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '1.2px',
            color: 'rgba(240,235,224,0.36)',
            marginBottom: 10,
            paddingLeft: 2,
          }}
        >
          {labels.comingUp}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {upcomingMeetings.map((meeting) => {
            const isExpanded = expandedMeetingId === meeting.id;

            return (
              <div
                key={meeting.id}
                onClick={() => setExpandedMeetingId(isExpanded ? null : meeting.id)}
                style={{
                  background: isExpanded
                    ? 'rgba(240,235,224,0.05)'
                    : 'rgba(240,235,224,0.03)',
                  border: isExpanded
                    ? '0.5px solid rgba(240,235,224,0.10)'
                    : '0.5px solid rgba(240,235,224,0.06)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: 'rgba(252,246,234,0.88)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {meeting.title}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'rgba(240,235,224,0.42)',
                      flexShrink: 0,
                    }}
                  >
                    {formatMeetingTime(meeting.scheduled_at)}
                  </span>
                </div>

                {/* Expanded inline actions */}
                {isExpanded && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '0.5px solid rgba(240,235,224,0.08)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); completeMeeting(meeting.id); setExpandedMeetingId(null); }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: `0.5px solid rgba(72,200,120,0.3)`,
                        background: 'rgba(72,200,120,0.08)',
                        color: COLORS.green,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        cursor: 'pointer',
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Done
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRescheduleOpen(meeting.id); }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: `0.5px solid rgba(56,184,200,0.3)`,
                        background: 'rgba(56,184,200,0.08)',
                        color: COLORS.teal,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        cursor: 'pointer',
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Move
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelMeeting(meeting.id); setExpandedMeetingId(null); }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: `0.5px solid rgba(224,88,64,0.25)`,
                        background: 'rgba(224,88,64,0.06)',
                        color: COLORS.red,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        cursor: 'pointer',
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        meeting.deal_id
                          ? openSurface('deal-prep', { dealId: meeting.deal_id })
                          : openSurface('briefing');
                      }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: '0.5px solid rgba(240,235,224,0.12)',
                        background: 'rgba(240,235,224,0.04)',
                        color: 'rgba(240,235,224,0.52)',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        cursor: 'pointer',
                        fontFamily: FONTS.sans,
                        marginLeft: 'auto',
                      }}
                    >
                      Open
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── SESSION 10: "EVERYTHING ELSE" (collapsed) ───────────
  const hasEverythingElse = topDeals.length > 0;

  const renderEverythingElse = () => {
    if (!hasEverythingElse) return null;

    return (
      <div key="everything_else" style={{ marginBottom: 16 }}>
        <div
          onClick={() => setEverythingElseOpen(prev => !prev)}
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '1.2px',
            color: 'rgba(240,235,224,0.24)',
            marginBottom: everythingElseOpen ? 10 : 0,
            paddingLeft: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'color 0.15s ease',
          }}
        >
          {labels.everythingElse}
          <span style={{ fontSize: 9, opacity: 0.6 }}>
            {everythingElseOpen ? '−' : '+'}
          </span>
        </div>

        {everythingElseOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topDeals.map((deal) => {
              const stageStyle = STAGE_STYLES[deal.stage] ?? STAGE_STYLES.Prospect;
              const days = getDaysSince(deal.last_activity_at);
              const valueStr = formatDealValue(deal.value, deal.value_type);
              return (
                <div
                  key={deal.id}
                  onClick={() => openSurface('deal-detail', { dealId: deal.id })}
                  style={{
                    background: 'rgba(240,235,224,0.03)',
                    border: '0.5px solid rgba(240,235,224,0.06)',
                    borderRadius: 12,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 400,
                        color: 'rgba(252,246,234,0.88)',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {deal.name}
                    </span>
                    {valueStr && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'rgba(240,235,224,0.50)',
                          flexShrink: 0,
                        }}
                      >
                        {valueStr}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: stageStyle.color,
                        background: stageStyle.bg,
                        border: `0.5px solid ${stageStyle.border}`,
                        borderRadius: 6,
                        padding: '2px 7px',
                        lineHeight: '1.4',
                      }}
                    >
                      {deal.stage}
                    </span>
                    {deal.accounts?.name && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 300,
                          color: 'rgba(240,235,224,0.36)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {deal.accounts.name}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 400,
                        color: getDaysColor(days),
                        marginLeft: 'auto',
                        flexShrink: 0,
                      }}
                    >
                      {days === 0 ? 'today' : `${days}d`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── DEEP LINKS ──────────────────────────────────────────
  const deepLinkStyle = {
    flex: 1,
    padding: '12px 0',
    borderRadius: 12,
    border: '0.5px solid rgba(240,235,224,0.08)',
    background: 'rgba(240,235,224,0.03)',
    color: 'rgba(240,235,224,0.56)',
    fontSize: 12,
    fontWeight: 500 as const,
    cursor: 'pointer' as const,
    fontFamily: FONTS.sans,
    transition: 'border-color 0.15s ease',
    letterSpacing: '0.2px',
  };

  const renderDeepLinks = () => (
    <div key="deep_links" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', paddingTop: 4 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => openSurface('deals')} style={deepLinkStyle}>
          {labels.allDeals}
        </button>
        <button onClick={() => openSurface('meetings')} style={deepLinkStyle}>
          {labels.meetings}
        </button>
        <button onClick={() => openSurface('ideas')} style={deepLinkStyle}>
          Ideas
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => openSurface('briefing')} style={deepLinkStyle}>
          Briefing
        </button>
        <button onClick={() => openSurface('settings')} style={deepLinkStyle}>
          {labels.settings}
        </button>
      </div>
    </div>
  );

  // ── SESSION 11C: EMPTY / CLEAR STATE (universal) ────────
  // Neutral language. No sales-specific hints.
  const hasContent = whatMattersItems || upcomingMeetings.length > 0 || topDeals.length > 0;

  const renderEmptyState = () => (
    <div
      style={{
        textAlign: 'center',
        padding: '32px 24px 24px',
      }}
    >
      <div
        style={{
          fontFamily: FONTS.serif,
          fontSize: 17,
          fontWeight: 300,
          color: 'rgba(252,246,234,0.44)',
          lineHeight: 1.5,
        }}
      >
        {isLowDataState
          ? 'Your world is taking shape.'
          : "Nothing pressing."}
      </div>
      {isLowDataState ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.24)',
            lineHeight: 1.5,
            maxWidth: 260,
            margin: '8px auto 0',
          }}
        >
          Add what&apos;s happening and Jove will organize it.
        </div>
      ) : (
        <div
          style={{
            fontSize: 12,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.20)',
            lineHeight: 1.5,
            maxWidth: 260,
            margin: '6px auto 0',
          }}
        >
          You&apos;re clear.
        </div>
      )}
    </div>
  );

  // ── RENDER ──────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 280,
          background: sheetVisible ? 'rgba(4,8,14,0.55)' : 'rgba(4,8,14,0)',
          backdropFilter: sheetVisible ? 'blur(14px)' : 'blur(0px)',
          WebkitBackdropFilter: sheetVisible ? 'blur(14px)' : 'blur(0px)',
          transition: 'background 0.32s ease, backdrop-filter 0.32s ease, -webkit-backdrop-filter 0.32s ease',
        }}
      />

      {/* Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 285,
          maxHeight: '82dvh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(15,19,28,0.92) 0%, rgba(11,14,22,0.95) 100%)',
          backdropFilter: 'blur(40px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.3)',
          borderRadius: '22px 22px 0 0',
          borderTop: '0.5px solid rgba(240,235,224,0.10)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.22), 0 -0.5px 0 rgba(240,235,224,0.04) inset',
          transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.32s cubic-bezier(.32,.72,0,1)',
          fontFamily: FONTS.sans,
        }}
      >
        {/* Handle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 12,
            paddingBottom: 16,
            flexShrink: 0,
          }}
        >
          <div
            onClick={handleClose}
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(240,235,224,0.14)',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Session 10: No header — section labels are enough.
            The panel answers one question: What matters right now? */}

        {/* Scrollable content — three-tier layout */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '0 18px 8px',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {hasContent ? (
            <>
              {renderWhatMatters()}
              {renderComingUp()}
              {renderEverythingElse()}
              {renderDeepLinks()}
            </>
          ) : (
            <>
              {renderEmptyState()}
              {renderDeepLinks()}
            </>
          )}
        </div>
      </div>

      {/* Session 8: Reschedule sheet + action toast */}
      <RescheduleSheet
        open={!!rescheduleTarget}
        meetingTitle={rescheduleTarget?.title ?? ''}
        currentStartTime={rescheduleTarget?.startTime ?? Date.now()}
        onConfirm={handleRescheduleConfirm}
        onClose={() => setRescheduleTarget(null)}
      />
      <MeetingActionToast />
    </>
  );
}
