'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  COLORS,
  STAGE_STYLES,
  getDaysColor,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type { DealRow, MeetingRow } from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────
type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface ControlSurfaceProps {
  open: boolean;
  onClose: () => void;
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
}

// ── HELPERS ────────────────────────────────────────────────
function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function isNeedsAttention(deal: DealRow): boolean {
  const inactive = getDaysSince(deal.last_activity_at) > PULSE_CHECK_DEFAULT_DAYS;
  const notClosed = deal.stage !== 'Closed Won' && deal.stage !== 'Closed Lost';
  const notSnoozed = !deal.snoozed_until ||
    new Date(deal.snoozed_until) < new Date();
  return inactive && notClosed && notSnoozed;
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

// ── COMPONENT ──────────────────────────────────────────────
export default function ControlSurface({
  open,
  onClose,
  allDeals,
  urgentDeals,
  meetings,
}: ControlSurfaceProps) {
  const router = useRouter();
  const [sheetVisible, setSheetVisible] = useState(false);

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

  const navigateTo = useCallback((path: string) => {
    handleClose();
    setTimeout(() => router.push(path), 200);
  }, [handleClose, router]);

  if (!open) return null;

  // ── DATA PREPARATION ────────────────────────────────────
  // Needs attention: urgent deals first, then any stale from allDeals
  const attentionItems = urgentDeals.length > 0
    ? urgentDeals.slice(0, 4)
    : allDeals.filter(isNeedsAttention).slice(0, 4);

  // Top deals: most recently active, excluding closed
  const topDeals = allDeals
    .filter(d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost')
    .slice(0, 5);

  // Upcoming meetings: future only, max 3
  const now = new Date();
  const upcomingMeetings = meetings
    .filter(m => new Date(m.scheduled_at) >= now)
    .slice(0, 3);

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
          background: 'linear-gradient(180deg, #111620 0%, #0d1018 100%)',
          borderRadius: '22px 22px 0 0',
          borderTop: '0.5px solid rgba(240,235,224,0.08)',
          transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.32s cubic-bezier(.32,.72,0,1)',
          fontFamily: "'DM Sans', sans-serif",
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
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.92)',
              letterSpacing: '-0.3px',
            }}
          >
            Your world
          </div>
        </div>

        {/* Scrollable modules */}
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
          {/* ── NEEDS ATTENTION ──────────────────────── */}
          {attentionItems.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  color: COLORS.amber,
                  marginBottom: 10,
                  paddingLeft: 2,
                }}
              >
                Needs attention
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {attentionItems.map((deal) => {
                  const days = getDaysSince(deal.last_activity_at);
                  return (
                    <div
                      key={deal.id}
                      onClick={() => navigateTo(`/deals/${deal.id}`)}
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
          )}

          {/* ── TOP DEALS ────────────────────────────── */}
          {topDeals.length > 0 && (
            <div style={{ marginBottom: 20 }}>
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
                Top deals
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topDeals.map((deal) => {
                  const stageStyle = STAGE_STYLES[deal.stage] ?? STAGE_STYLES.Prospect;
                  const days = getDaysSince(deal.last_activity_at);
                  const valueStr = formatDealValue(deal.value, deal.value_type);
                  return (
                    <div
                      key={deal.id}
                      onClick={() => navigateTo(`/deals/${deal.id}`)}
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
          )}

          {/* ── UPCOMING MEETINGS ────────────────────── */}
          {upcomingMeetings.length > 0 && (
            <div style={{ marginBottom: 20 }}>
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
                Upcoming
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {upcomingMeetings.map((meeting) => {
                  // Navigate to deal prep if deal is linked, otherwise briefing
                  const destination = meeting.deal_id
                    ? `/deals/${meeting.deal_id}/prep`
                    : '/briefing';
                  return (
                    <div
                      key={meeting.id}
                      onClick={() => navigateTo(destination)}
                      style={{
                        background: 'rgba(240,235,224,0.03)',
                        border: '0.5px solid rgba(240,235,224,0.06)',
                        borderRadius: 12,
                        padding: '10px 14px',
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
                            fontWeight: 400,
                            color: 'rgba(240,235,224,0.42)',
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
          )}

          {/* ── EMPTY STATE ──────────────────────────── */}
          {attentionItems.length === 0 && topDeals.length === 0 && upcomingMeetings.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
              }}
            >
              <span
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 16,
                  fontWeight: 300,
                  color: 'rgba(240,235,224,0.28)',
                }}
              >
                All clear. Nothing needs your attention.
              </span>
            </div>
          )}

          {/* ── DEEP LINKS ───────────────────────────── */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
              paddingTop: 4,
            }}
          >
            <button
              onClick={() => navigateTo('/deals')}
              style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: '0.5px solid rgba(240,235,224,0.08)',
                background: 'rgba(240,235,224,0.03)',
                color: 'rgba(240,235,224,0.56)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                transition: 'border-color 0.15s ease',
                letterSpacing: '0.2px',
              }}
            >
              All deals
            </button>
            <button
              onClick={() => navigateTo('/meetings')}
              style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: '0.5px solid rgba(240,235,224,0.08)',
                background: 'rgba(240,235,224,0.03)',
                color: 'rgba(240,235,224,0.56)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                transition: 'border-color 0.15s ease',
                letterSpacing: '0.2px',
              }}
            >
              Meetings
            </button>
            <button
              onClick={() => navigateTo('/settings')}
              style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: '0.5px solid rgba(240,235,224,0.08)',
                background: 'rgba(240,235,224,0.03)',
                color: 'rgba(240,235,224,0.56)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                transition: 'border-color 0.15s ease',
                letterSpacing: '0.2px',
              }}
            >
              Settings
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
