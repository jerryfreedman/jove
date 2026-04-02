// ── SESSION 13: ITEM DASHBOARD ──────────────────────────────
// Full detail view for a single item with context.
// Shows: header, AI summary (temp mock), next action (temp mock),
// tasks, people, and activity feed.
// Follows existing glass UI patterns.

'use client';

import { useMemo } from 'react';
import { COLORS, FONTS } from '@/lib/design-system';
import { normalizeItemStatus } from '@/lib/types';
import type { ItemWithContext } from '@/lib/hooks/useItemWithContext';

// ── STATUS COLOR MAP ───────────────────────────────────────

function statusColor(status: string): string {
  const normalized = normalizeItemStatus(status as any);
  switch (normalized) {
    case 'active':      return COLORS.green;
    case 'in_progress': return COLORS.teal;
    case 'waiting':     return COLORS.amber;
    case 'blocked':     return COLORS.red;
    case 'completed':   return COLORS.textLight;
    case 'archived':    return COLORS.textLight;
    default:            return COLORS.textMid;
  }
}

function statusLabel(status: string): string {
  const normalized = normalizeItemStatus(status as any);
  switch (normalized) {
    case 'active':      return 'Active';
    case 'in_progress': return 'In Progress';
    case 'waiting':     return 'Waiting';
    case 'blocked':     return 'Blocked';
    case 'completed':   return 'Completed';
    case 'archived':    return 'Archived';
    default:            return status;
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

function formatDueDate(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return `in ${diffDays}d`;
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

interface ItemDashboardProps {
  item: ItemWithContext;
}

export default function ItemDashboard({ item }: ItemDashboardProps) {
  // Temp mocks — will be replaced with real AI in session 14
  const summary = 'In progress. Recent activity detected. Needs follow-up.';
  const nextAction = 'Follow up on latest update';

  const visibleTasks = useMemo(
    () => item.tasks
      .filter(t => t.status !== 'done' && t.status !== 'skipped')
      .slice(0, 5),
    [item.tasks],
  );

  const visibleInteractions = useMemo(
    () => item.interactions.slice(0, 5),
    [item.interactions],
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
          {item.title}
        </h1>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 8,
        }}>
          {/* Status badge */}
          <span style={{
            fontSize: 11,
            fontWeight: 500,
            color: statusColor(item.status),
            background: `${statusColor(item.status)}18`,
            padding: '2px 8px',
            borderRadius: 4,
          }}>
            {statusLabel(item.status)}
          </span>

          {/* Last updated */}
          <span style={{
            fontSize: 12,
            color: COLORS.textLight,
          }}>
            Updated {timeAgo(item.updated_at)}
          </span>
        </div>
      </div>

      {/* ── AI SUMMARY (TEMP MOCK) ──────────────────────────── */}
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

      {/* ── NEXT ACTION (TEMP MOCK) ─────────────────────────── */}
      <div style={{
        background: `${COLORS.amber}10`,
        border: `1px solid ${COLORS.amber}20`,
        borderRadius: 10,
        padding: '12px 16px',
        marginTop: 8,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 500,
          color: COLORS.amber,
          letterSpacing: '0.04em',
          marginBottom: 4,
        }}>
          NEXT ACTION
        </div>
        <div style={{
          fontSize: 14,
          color: COLORS.textPrimary,
          lineHeight: 1.4,
        }}>
          {nextAction}
        </div>
      </div>

      {/* ── TASKS ───────────────────────────────────────────── */}
      {visibleTasks.length > 0 && (
        <>
          <SectionHeader title="Tasks" />
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            {visibleTasks.map(task => (
              <div
                key={task.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.cardBorder}`,
                }}
              >
                <span style={{
                  fontSize: 13,
                  color: COLORS.textPrimary,
                  flex: 1,
                  lineHeight: 1.4,
                }}>
                  {task.title}
                </span>
                {task.due_at && (
                  <span style={{
                    fontSize: 11,
                    color: new Date(task.due_at).getTime() < Date.now()
                      ? COLORS.red
                      : COLORS.textLight,
                    marginLeft: 12,
                    flexShrink: 0,
                  }}>
                    {formatDueDate(task.due_at)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── PEOPLE ──────────────────────────────────────────── */}
      {item.people.length > 0 && (
        <>
          <SectionHeader title="People" />
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}>
            {item.people.slice(0, 6).map(person => (
              <div
                key={person.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.cardBorder}`,
                }}
              >
                {/* Avatar circle */}
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  background: `${COLORS.teal}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  color: COLORS.teal,
                }}>
                  {person.name.charAt(0).toUpperCase()}
                </div>
                <span style={{
                  fontSize: 13,
                  color: COLORS.textPrimary,
                }}>
                  {person.name}
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
                  // Truncate long interaction text
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
      {visibleTasks.length === 0 && item.people.length === 0 && visibleInteractions.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '48px 20px',
          color: COLORS.textLight,
          fontSize: 14,
        }}>
          No tasks, people, or activity yet.
        </div>
      )}
    </div>
  );
}
