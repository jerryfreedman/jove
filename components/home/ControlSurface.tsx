'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  COLORS,
  STAGE_STYLES,
  getDaysColor,
  FONTS,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import {
  evaluateModulePriority,
  isNeedsAttention,
  scoreDealRelevance,
  scoreAttentionUrgency,
  type ModuleId,
  type ModulePriorityResult,
} from '@/lib/module-priority';
import type { DealRow, MeetingRow, UserDomainProfile } from '@/lib/types';
import {
  DEFAULT_DOMAIN_PROFILE,
  getControlSurfaceLabels,
} from '@/lib/semantic-labels';
import { useSurface } from '@/components/surfaces/SurfaceManager';

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

  // ── ADAPTIVE MODULE PRIORITY ────────────────────────────
  const priority = useMemo<ModulePriorityResult>(() => {
    return evaluateModulePriority({ allDeals, urgentDeals, meetings });
  }, [allDeals, urgentDeals, meetings]);

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

    // Upcoming meetings: future only, sorted by soonest first
    const upcomingMeetings = meetings
      .filter(m => new Date(m.scheduled_at) >= now)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, 3);

    return { attentionItems, topDeals, upcomingMeetings };
  }, [allDeals, urgentDeals, meetings]);

  if (!open) return null;

  const { attentionItems, topDeals, upcomingMeetings } = preparedData;
  const { visibleModules, isLowDataState } = priority;

  // ── MODULE RENDERERS ────────────────────────────────────
  // Each module is a self-contained render function keyed by ModuleId.
  // The adaptive system calls them in priority order.

  const renderModule = (moduleId: ModuleId, isProminent: boolean) => {
    switch (moduleId) {
      case 'needs_attention':
        return renderNeedsAttention(isProminent);
      case 'upcoming_meetings':
        return renderUpcomingMeetings(isProminent);
      case 'top_deals':
        return renderTopDeals(isProminent);
      case 'deep_links':
        return renderDeepLinks();
      default:
        return null;
    }
  };

  // ── NEEDS ATTENTION ─────────────────────────────────────
  const renderNeedsAttention = (isProminent: boolean) => (
    <div key="needs_attention" style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '1.2px',
          color: COLORS.amber,
          marginBottom: 10,
          paddingLeft: 2,
          // Prominent: slightly larger label
          ...(isProminent ? { fontSize: 11, letterSpacing: '1.4px' } : {}),
        }}
      >
        {labels.needsAttention}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {attentionItems.map((deal) => {
          const days = getDaysSince(deal.last_activity_at);
          return (
            <div
              key={deal.id}
              onClick={() => openSurface('deal-detail', { dealId: deal.id })}
              style={{
                background: isProminent
                  ? 'rgba(232,160,48,0.08)'
                  : 'rgba(232,160,48,0.06)',
                border: isProminent
                  ? '0.5px solid rgba(232,160,48,0.16)'
                  : '0.5px solid rgba(232,160,48,0.12)',
                borderRadius: 12,
                padding: isProminent ? '13px 14px' : '11px 14px',
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

  // ── UPCOMING MEETINGS ───────────────────────────────────
  const renderUpcomingMeetings = (isProminent: boolean) => {
    // Check if the first meeting is imminent for visual emphasis
    const firstMeeting = upcomingMeetings[0];
    const isImminent = firstMeeting && minutesUntil(firstMeeting.scheduled_at) <= 120;

    return (
      <div key="upcoming_meetings" style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: isProminent ? 11 : 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: isProminent ? '1.4px' : '1.2px',
            color: isProminent && isImminent
              ? COLORS.amber
              : 'rgba(240,235,224,0.36)',
            marginBottom: 10,
            paddingLeft: 2,
          }}
        >
          {isImminent ? labels.comingUp : labels.upcoming}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {upcomingMeetings.map((meeting, idx) => {
            // First meeting gets emphasis when prominent and imminent
            const isHighlighted = isProminent && isImminent && idx === 0;

            return (
              <div
                key={meeting.id}
                onClick={() => meeting.deal_id
                  ? openSurface('deal-prep', { dealId: meeting.deal_id })
                  : openSurface('briefing')
                }
                style={{
                  background: isHighlighted
                    ? 'rgba(232,160,48,0.06)'
                    : 'rgba(240,235,224,0.03)',
                  border: isHighlighted
                    ? '0.5px solid rgba(232,160,48,0.14)'
                    : '0.5px solid rgba(240,235,224,0.06)',
                  borderRadius: 12,
                  padding: isHighlighted ? '12px 14px' : '10px 14px',
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
                    {meeting.title}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: isHighlighted ? 500 : 400,
                      color: isHighlighted
                        ? COLORS.amber
                        : 'rgba(240,235,224,0.42)',
                      marginLeft: 10,
                      flexShrink: 0,
                    }}
                  >
                    {formatMeetingTime(meeting.scheduled_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── TOP DEALS ───────────────────────────────────────────
  const renderTopDeals = (isProminent: boolean) => (
    <div key="top_deals" style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: isProminent ? 11 : 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: isProminent ? '1.4px' : '1.2px',
          color: 'rgba(240,235,224,0.36)',
          marginBottom: 10,
          paddingLeft: 2,
        }}
      >
        {labels.topDeals}
      </div>
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
                background: isProminent
                  ? 'rgba(240,235,224,0.04)'
                  : 'rgba(240,235,224,0.03)',
                border: isProminent
                  ? '0.5px solid rgba(240,235,224,0.08)'
                  : '0.5px solid rgba(240,235,224,0.06)',
                borderRadius: 12,
                padding: isProminent ? '11px 14px' : '10px 14px',
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
                {/* Stage badge */}
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
    </div>
  );

  // ── DEEP LINKS (always present, always last) ────────────
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
      {/* Primary row */}
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
      {/* Secondary row */}
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

  // ── LOW DATA / EMPTY STATE ──────────────────────────────
  // Shown when the only visible module is deep_links (no real content).
  const hasContentModules = visibleModules.some(
    m => m.id !== 'deep_links'
  );

  const renderLowDataState = () => (
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
          marginBottom: 8,
        }}
      >
        {isLowDataState
          ? 'Your world is taking shape'
          : 'All clear for now'}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 300,
          color: 'rgba(240,235,224,0.24)',
          lineHeight: 1.5,
          maxWidth: 260,
          margin: '0 auto',
        }}
      >
        {isLowDataState
          ? `As you add ${labels.allDeals.toLowerCase()} and meetings, this surface will show what matters most.`
          : 'Nothing needs your attention right now. This will update as things change.'}
      </div>
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
            paddingBottom: 4,
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

        {/* Header */}
        <div
          style={{
            padding: '8px 22px 16px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.serif,
              fontSize: 22,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.92)',
              letterSpacing: '-0.3px',
            }}
          >
            Your world
          </div>
        </div>

        {/* Scrollable modules — rendered in adaptive priority order */}
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
          {/* Content modules in priority order */}
          {hasContentModules
            ? visibleModules.map(mod =>
                renderModule(mod.id, mod.isProminent)
              )
            : (
              <>
                {renderLowDataState()}
                {renderDeepLinks()}
              </>
            )
          }
        </div>
      </div>
    </>
  );
}
