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

  // ── SESSION 9: System-derived task engine ──
  const systemTasks = useTaskEngine(allDeals);

  // ── ADAPTIVE MODULE PRIORITY ────────────────────────────
  const priority = useMemo<ModulePriorityResult>(() => {
    return evaluateModulePriority({ allDeals, urgentDeals, meetings, systemTaskCount: systemTasks.length });
  }, [allDeals, urgentDeals, meetings, systemTasks.length]);

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

  if (!open) return null;

  const { attentionItems, topDeals, upcomingMeetings } = preparedData;
  const { isLowDataState } = priority;

  // ── SESSION 9: Task action handler ──
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

  // ── SESSION 10: "WHAT MATTERS" ──────────────────────────
  // Unified section: system tasks + attention items, max 5 total
  const whatMattersItems = systemTasks.length > 0 || attentionItems.length > 0;

  const renderWhatMatters = () => {
    if (!whatMattersItems) return null;

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
          {/* System tasks first */}
          {systemTasks.slice(0, 5).map((task) => {
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
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: accent.color,
                        marginLeft: 10,
                        flexShrink: 0,
                      }}
                    >
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
          })}

          {/* Attention items — only if space remains under 5 total */}
          {systemTasks.length < 5 && attentionItems.slice(0, 5 - systemTasks.length).map((deal) => {
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

  // ── SESSION 10: EMPTY / CLEAR STATE ─────────────────────
  // Direct voice. No fluff.
  const hasContent = whatMattersItems || upcomingMeetings.length > 0;

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
          : "You\u2019re clear."}
      </div>
      {isLowDataState && (
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
          {`Add ${labels.allDeals.toLowerCase()} and meetings to get started.`}
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
