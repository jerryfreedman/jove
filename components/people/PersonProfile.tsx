// ── SESSION 16: PERSON PROFILE ──────────────────────────────
// Full detail view for a single person with context.
// Shows: header + state, AI summary, next action,
// linked items (clickable), and activity feed.
// Follows the ItemDashboard glass UI pattern exactly.

'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { COLORS, FONTS } from '@/lib/design-system';
import type { PersonWithContext } from '@/lib/hooks/usePeopleWithContext';
import { usePersonIntelligence } from '@/lib/hooks/usePersonIntelligence';

// ── STATE COLOR MAP ───────────────────────────────────────

function stateColor(state: string): string {
  switch (state) {
    case 'active':  return COLORS.green;
    case 'normal':  return COLORS.teal;
    case 'stale':   return COLORS.amber;
    case 'unknown': return COLORS.textLight;
    default:        return COLORS.textMid;
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'active':  return 'Active';
    case 'normal':  return 'Normal';
    case 'stale':   return 'Stale';
    case 'unknown': return 'Unknown';
    default:        return state;
  }
}

// ── TIME FORMATTING ────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// ── SECTION HEADER ─────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 11,
      fontFamily: FONTS.sans,
      fontWeight: 500,
      color: COLORS.textLight,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
      marginBottom: 8,
      marginTop: 24,
    }}>
      {title}
    </div>
  );
}

// ── COMPONENT ──────────────────────────────────────────────

interface PersonProfileProps {
  person: PersonWithContext;
}

export default function PersonProfile({ person }: PersonProfileProps) {
  const router = useRouter();
  const { summary, lastInteraction, nextAction, state } = usePersonIntelligence(person);

  // State-aware accent for next action
  const actionAccent = state === 'stale' ? COLORS.amber : COLORS.teal;

  const visibleInteractions = useMemo(
    () => person.interactions.slice(0, 5),
    [person.interactions],
  );

  return (
    <div style={{
      minHeight: '100dvh',
      background: COLORS.bg,
      color: COLORS.textPrimary,
      fontFamily: FONTS.sans,
      padding: '0 20px 40px',
      maxWidth: 480,
      margin: '0 auto',
    }}>
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{ paddingTop: 60, marginBottom: 24 }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 500,
          fontFamily: FONTS.serif,
          color: COLORS.textPrimary,
          margin: 0,
          lineHeight: 1.3,
        }}>
          {person.name}
        </h1>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 8,
        }}>
          {/* State badge */}
          <span style={{
            fontSize: 11,
            fontWeight: 500,
            color: stateColor(state),
            background: `${stateColor(state)}18`,
            padding: '2px 8px',
            borderRadius: 4,
          }}>
            {stateLabel(state)}
          </span>

          {/* Relationship if available */}
          {person.relationship && (
            <span style={{
              fontSize: 12,
              color: COLORS.textLight,
            }}>
              {person.relationship}
            </span>
          )}

          {/* Last interaction */}
          <span style={{
            fontSize: 12,
            color: COLORS.textLight,
          }}>
            Last: {lastInteraction}
          </span>
        </div>
      </div>

      {/* ── AI SUMMARY ──────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 4,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 500,
          color: COLORS.textLight,
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}>
          SUMMARY
        </div>
        <div style={{
          fontSize: 14,
          color: COLORS.textPrimary,
          lineHeight: 1.5,
          opacity: 0.85,
        }}>
          {summary}
        </div>
      </div>

      {/* ── NEXT ACTION ─────────────────────────────────────── */}
      <div style={{
        background: `${actionAccent}10`,
        border: `1px solid ${actionAccent}22`,
        borderRadius: 10,
        padding: '16px 18px',
        marginTop: 8,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 500,
          color: actionAccent,
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}>
          NEXT ACTION
        </div>
        <div style={{
          fontSize: 16,
          fontWeight: 500,
          color: COLORS.textPrimary,
          lineHeight: 1.4,
        }}>
          {nextAction}
        </div>
      </div>

      {/* ── LINKED ITEMS ────────────────────────────────────── */}
      {person.items.length > 0 && (
        <>
          <SectionHeader title="Linked Items" />
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            {person.items.map(item => (
              <div
                key={item.id}
                onClick={() => router.push(`/item/${item.id}`)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.cardBorder}`,
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  fontSize: 13,
                  color: COLORS.textPrimary,
                  flex: 1,
                  lineHeight: 1.4,
                }}>
                  {item.name}
                </span>
                <span style={{
                  fontSize: 11,
                  color: COLORS.textLight,
                  marginLeft: 12,
                  flexShrink: 0,
                }}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── ACTIVITY FEED ───────────────────────────────────── */}
      {visibleInteractions.length > 0 && (
        <>
          <SectionHeader title="Recent Activity" />
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            {visibleInteractions.map(interaction => (
              <div
                key={interaction.id}
                style={{
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.cardBorder}`,
                }}
              >
                <div style={{
                  fontSize: 13,
                  color: COLORS.textPrimary,
                  lineHeight: 1.4,
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as any,
                }}>
                  {interaction.raw_content}
                </div>
                <div style={{
                  fontSize: 11,
                  color: COLORS.textLight,
                }}>
                  {timeAgo(interaction.created_at)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── EMPTY STATE ─────────────────────────────────────── */}
      {person.items.length === 0 && visibleInteractions.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '48px 20px',
          color: COLORS.textLight,
          fontSize: 14,
        }}>
          No linked items or activity yet.
        </div>
      )}
    </div>
  );
}
