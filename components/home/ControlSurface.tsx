'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  COLORS,
  getDaysColor,
  FONTS,
} from '@/lib/design-system';
import {
  evaluateModulePriority,
  isNeedsAttention,
  type SurfaceEvalResult,
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

// ── SESSION 12A: UNIFIED SURFACE ITEM ──────────────────────
// Every row on the surface is the same shape.
// No type labels. No "task" vs "meeting" vs "deal" distinction.
// Just: a thing to handle or be aware of.

interface SurfaceItem {
  id: string;
  title: string;
  /** Time indicator (if relevant). */
  time?: string;
  /** Subtle emphasis for urgency. */
  emphasis?: boolean;
  onClick?: () => void;
  /** For persistent tasks: done/skip actions. */
  taskActions?: {
    taskId: string;
  };
  /** Internal: used for deduplication & zone assignment. Not displayed. */
  _zone: 'what_matters' | 'coming_up' | 'everything_else';
  /** Internal: sort key within a zone. Lower = higher. */
  _sortKey: number;
}

// ── HELPERS ────────────────────────────────────────────────

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

function minutesUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60);
}

function formatDueAt(dueAt: string | null): string | null {
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
}

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
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

  // ── Meeting actions ──
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

  // ── Legacy system-derived task engine (fallback) ──
  const legacySystemTasks = useTaskEngine(allDeals);

  // ── Persistent task reads from DB ──
  const { tasks: dbTasks, loading: dbTasksLoading, refetch: refetchTasks } = useWhatMattersTasks(userId ?? null, 5);

  // ── Unified task list — DB primary, legacy fallback ──
  const [taskActionPending, setTaskActionPending] = useState<string | null>(null);

  const { unifiedTasks, usingFallback } = useMemo(() => {
    if (!dbTasksLoading && dbTasks.length > 0) {
      return { unifiedTasks: dbTasks, usingFallback: false };
    }
    if (dbTasksLoading && legacySystemTasks.length > 0) {
      return { unifiedTasks: null, usingFallback: true };
    }
    if (!dbTasksLoading && dbTasks.length === 0 && legacySystemTasks.length > 0) {
      return { unifiedTasks: null, usingFallback: true };
    }
    return { unifiedTasks: dbTasks, usingFallback: false };
  }, [dbTasks, dbTasksLoading, legacySystemTasks]);

  const effectiveTaskCount = usingFallback
    ? legacySystemTasks.length
    : (unifiedTasks?.length ?? 0);

  // ── Task action handler ──
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

  // ── Evaluate decision surface (low data state only) ──
  const priority = useMemo<SurfaceEvalResult>(() => {
    return evaluateModulePriority({ allDeals, urgentDeals, meetings, systemTaskCount: effectiveTaskCount });
  }, [allDeals, urgentDeals, meetings, effectiveTaskCount]);

  // ── Meeting store for status-aware filtering ──
  const meetingStoreData = useMeetingStore(state => state.meetings);

  // ── SESSION 12A: BUILD UNIFIED SURFACE ───────────────────
  // All items flow into 3 zones. No module concept. No type labels.
  // Each item appears in exactly ONE zone.

  const { whatMatters, comingUp, everythingElse } = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Track IDs to enforce no-duplication
    const placed = new Set<string>();

    // ── WHAT MATTERS ────────────────────────────────────────
    // Tasks (DB-backed or legacy) are the primary content here.
    // These already include meeting prep, follow-ups, and stale items.
    const whatMattersItems: SurfaceItem[] = [];

    if (!usingFallback && unifiedTasks) {
      for (const task of unifiedTasks.slice(0, 5)) {
        whatMattersItems.push({
          id: `task-${task.id}`,
          title: task.title,
          time: formatDueAt(task.dueAt) ?? undefined,
          emphasis: task.dueAt ? new Date(task.dueAt).getTime() < now.getTime() : false,
          onClick: task.action ? () => handleTaskAction(task.action!) : undefined,
          taskActions: { taskId: task.id },
          _zone: 'what_matters',
          _sortKey: 0,
        });
        placed.add(`task-${task.id}`);
        // Mark linked entities so they don't duplicate into other zones
        if (task.meetingId) placed.add(`meeting-${task.meetingId}`);
        if (task.dealId) placed.add(`deal-${task.dealId}`);
      }
    } else if (usingFallback) {
      for (const task of legacySystemTasks.slice(0, 5)) {
        whatMattersItems.push({
          id: `legacy-${task.id}`,
          title: task.title,
          time: task.timeRelevance ?? undefined,
          emphasis: false,
          onClick: () => handleTaskAction(task.action),
          _zone: 'what_matters',
          _sortKey: 0,
        });
        placed.add(`legacy-${task.id}`);
        // Mark linked entities so they don't duplicate into other zones
        if (task.contextId) {
          if (task.type === 'meeting_prep' || task.type === 'meeting_followup') {
            placed.add(`meeting-${task.contextId}`);
          } else {
            placed.add(`deal-${task.contextId}`);
          }
        }
      }
    }

    // If task slots remain (< 5), fill with urgent attention items
    // These are deals that need re-engagement — surfaced as actionable items
    if (whatMattersItems.length < 5) {
      const attentionCandidates = urgentDeals.length > 0
        ? urgentDeals
        : allDeals.filter(isNeedsAttention);
      const remaining = 5 - whatMattersItems.length;
      for (const deal of attentionCandidates.slice(0, remaining)) {
        const days = getDaysSince(deal.last_activity_at);
        whatMattersItems.push({
          id: `attn-${deal.id}`,
          title: deal.name,
          time: `${days}d ago`,
          emphasis: days > 14,
          onClick: () => openSurface('deal-detail', { dealId: deal.id }),
          _zone: 'what_matters',
          _sortKey: 1,
        });
        placed.add(`deal-${deal.id}`);
      }
    }

    // ── COMING UP ───────────────────────────────────────────
    // Strictly time-based. Next few hours / today.
    // No priority logic — just temporal clarity.
    const upcomingMeetings = meetings
      .filter(m => {
        if (placed.has(`meeting-${m.id}`)) return false;
        const storeMeeting = meetingStoreData[m.id];
        if (storeMeeting) {
          return storeMeeting.status === 'scheduled' && storeMeeting.startTime >= now.getTime() - 2 * 60 * 60 * 1000;
        }
        return new Date(m.scheduled_at) >= now;
      })
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, 3);

    const comingUpItems: SurfaceItem[] = upcomingMeetings.map((m, i) => ({
      id: `meeting-${m.id}`,
      title: m.title,
      time: formatMeetingTime(m.scheduled_at),
      emphasis: minutesUntil(m.scheduled_at) <= 60,
      onClick: () => setExpandedMeetingId(prev => prev === m.id ? null : m.id),
      _zone: 'coming_up' as const,
      _sortKey: i,
    }));

    for (const item of comingUpItems) {
      placed.add(item.id);
    }

    // ── EVERYTHING ELSE ─────────────────────────────────────
    // Remaining items not already placed by tasks or attention logic.
    // Collapsed by default. Sorted by recency. No subcategories.
    const everythingElseItems: SurfaceItem[] = [];

    // Remaining active deals not already placed
    const remainingDeals = allDeals
      .filter(d => {
        if (placed.has(`deal-${d.id}`)) return false;
        return d.stage !== 'Closed Won' && d.stage !== 'Closed Lost';
      })
      .sort((a, b) => {
        // Sort by last activity (most recent first)
        return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
      })
      .slice(0, 8);

    for (const deal of remainingDeals) {
      const days = getDaysSince(deal.last_activity_at);
      everythingElseItems.push({
        id: `deal-${deal.id}`,
        title: deal.name,
        time: days === 0 ? 'today' : `${days}d`,
        emphasis: false,
        onClick: () => openSurface('deal-detail', { dealId: deal.id }),
        _zone: 'everything_else',
        _sortKey: days,
      });
    }

    return {
      whatMatters: whatMattersItems,
      comingUp: comingUpItems,
      everythingElse: everythingElseItems,
    };
  }, [
    allDeals, urgentDeals, meetings, meetingStoreData,
    unifiedTasks, usingFallback, legacySystemTasks,
    handleTaskAction, openSurface,
  ]);

  // ── ALL HOOKS ABOVE THIS LINE ───────────────────────────
  if (!open) return null;

  const { isLowDataState } = priority;
  const hasContent = whatMatters.length > 0 || comingUp.length > 0 || everythingElse.length > 0;

  // ── Task actions (done/skip) ──
  const handleTaskDone = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskActionPending(taskId);
    const ok = await markTaskDone(taskId);
    setTaskActionPending(null);
    if (ok) refetchTasks();
  };

  const handleTaskSkip = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskActionPending(taskId);
    const ok = await skipTask(taskId);
    setTaskActionPending(null);
    if (ok) refetchTasks();
  };

  // ── SESSION 12B: UNIFIED ROW RENDERER ─────────────────────
  // Every row is identical in structure: title + time + actions.
  // No type labels. No weight differences between zones.
  // Consistent padding, font, truncation across all items.

  const ROW_STYLE = {
    background: 'rgba(240,235,224,0.03)',
    border: '0.5px solid rgba(240,235,224,0.06)',
    borderRadius: 12,
    padding: '11px 14px',
    transition: 'border-color 0.15s ease, opacity 0.2s ease',
  } as const;

  const renderRow = (item: SurfaceItem) => {
    const isPending = item.taskActions ? taskActionPending === item.taskActions.taskId : false;
    const isMeeting = item.id.startsWith('meeting-');
    const meetingId = isMeeting ? item.id.replace('meeting-', '') : null;
    const isExpanded = meetingId ? expandedMeetingId === meetingId : false;

    return (
      <div
        key={item.id}
        onClick={item.onClick}
        style={{
          ...ROW_STYLE,
          borderColor: isExpanded ? 'rgba(240,235,224,0.10)' : undefined,
          cursor: item.onClick ? 'pointer' : 'default',
          opacity: isPending ? 0.4 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
            {item.title}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {item.time && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: item.emphasis ? COLORS.amber : 'rgba(240,235,224,0.42)',
                }}
              >
                {item.time}
              </span>
            )}

            {item.taskActions && (
              <>
                <button
                  onClick={(e) => handleTaskDone(item.taskActions!.taskId, e)}
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
                  onClick={(e) => handleTaskSkip(item.taskActions!.taskId, e)}
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
              </>
            )}
          </div>
        </div>

        {/* Inline actions — expand on tap, no page navigation */}
        {isMeeting && isExpanded && meetingId && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 10,
              paddingTop: 10,
              borderTop: '0.5px solid rgba(240,235,224,0.06)',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); completeMeeting(meetingId); setExpandedMeetingId(null); }}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '0.5px solid rgba(72,200,120,0.3)',
                background: 'rgba(72,200,120,0.08)',
                color: COLORS.green,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
              }}
            >
              Done
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRescheduleOpen(meetingId); }}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '0.5px solid rgba(56,184,200,0.3)',
                background: 'rgba(56,184,200,0.08)',
                color: COLORS.teal,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
              }}
            >
              Move
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); cancelMeeting(meetingId); setExpandedMeetingId(null); }}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '0.5px solid rgba(224,88,64,0.25)',
                background: 'rgba(224,88,64,0.06)',
                color: COLORS.red,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── ZONE RENDERERS ──────────────────────────────────────
  // Consistent header style across all zones.
  // Uniform gap between rows (5px). No visual weight differences.

  const ZONE_HEADER = {
    fontSize: 10,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '1.2px',
    marginBottom: 8,
    paddingLeft: 2,
  };

  const renderWhatMatters = () => {
    if (whatMatters.length === 0) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ ...ZONE_HEADER, color: COLORS.amber }}>
          {labels.whatMatters}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {whatMatters.map(item => renderRow(item))}
        </div>
      </div>
    );
  };

  const renderComingUp = () => {
    if (comingUp.length === 0) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ ...ZONE_HEADER, color: 'rgba(240,235,224,0.36)' }}>
          {labels.comingUp}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {comingUp.map(item => renderRow(item))}
        </div>
      </div>
    );
  };

  const renderEverythingElse = () => {
    if (everythingElse.length === 0) return null;
    return (
      <div style={{ marginBottom: 12 }}>
        <div
          onClick={() => setEverythingElseOpen(prev => !prev)}
          style={{
            ...ZONE_HEADER,
            color: 'rgba(240,235,224,0.24)',
            marginBottom: everythingElseOpen ? 8 : 0,
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {everythingElse.map(item => renderRow(item))}
          </div>
        )}
      </div>
    );
  };

  // ── SURFACE ACCESS (secondary, not navigation) ──────────
  // Minimal row of access points. Not a nav menu.
  // Feels like part of the surface, not a router.
  const accessStyle = {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    border: 'none',
    background: 'transparent',
    color: 'rgba(240,235,224,0.32)',
    fontSize: 11,
    fontWeight: 500 as const,
    cursor: 'pointer' as const,
    fontFamily: FONTS.sans,
    transition: 'color 0.15s ease',
  };

  const renderAccess = () => (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', paddingTop: 8 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => openSurface('deals')} style={accessStyle}>
          {labels.allItems}
        </button>
        <button onClick={() => openSurface('meetings')} style={accessStyle}>
          {labels.meetings}
        </button>
        <button onClick={() => openSurface('ideas')} style={accessStyle}>
          Ideas
        </button>
        <button onClick={() => openSurface('settings')} style={accessStyle}>
          {labels.settings}
        </button>
      </div>
    </div>
  );

  // ── SESSION 12C: ZERO STATE + EMPTY STATE ────────────────
  // Zero state: calm, confident, minimal. Not a tutorial.
  // Low data: "You're clear beyond this." — calm, not empty.
  // Full clear: "You're clear." — intentional, not broken.
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
          color: 'rgba(252,246,234,0.40)',
          lineHeight: 1.5,
        }}
      >
        {isLowDataState
          ? 'What\u2019s going on today?'
          : "You\u2019re clear."}
      </div>
      {isLowDataState && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.20)',
            lineHeight: 1.5,
            maxWidth: 240,
            margin: '8px auto 0',
          }}
        >
          Tell me anything — I&apos;ll organize it.
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

      {/* Sheet — reduced top padding, content sits higher */}
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
        {/* Handle — tighter padding */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 10,
            paddingBottom: 12,
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

        {/* Scrollable content — one continuous surface, no hard dividers */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '0 16px 6px',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {hasContent ? (
            <>
              {renderWhatMatters()}
              {renderComingUp()}
              {renderEverythingElse()}
              {/* Session 12C: Low data calm reinforcement — only when sparse */}
              {isLowDataState && whatMatters.length > 0 && whatMatters.length <= 3 && comingUp.length === 0 && everythingElse.length === 0 && (
                <div style={{
                  textAlign: 'center',
                  padding: '12px 0 4px',
                }}>
                  <span style={{
                    fontFamily: FONTS.serif,
                    fontSize: 13,
                    fontWeight: 300,
                    color: 'rgba(240,235,224,0.20)',
                  }}>
                    You&apos;re clear beyond this.
                  </span>
                </div>
              )}
              {renderAccess()}
            </>
          ) : (
            <>
              {renderEmptyState()}
              {renderAccess()}
            </>
          )}
        </div>
      </div>

      {/* Reschedule sheet + action toast */}
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
