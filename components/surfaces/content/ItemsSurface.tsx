// ── SESSION 9: ITEMS SURFACE ────────────────────────────────
// Minimal surface for viewing user's items.
// Operational, not overdesigned. Follows IdeasSurface pattern.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { COLORS, FONTS, TIMING, EASING } from '@/lib/design-system';
import type { ItemRow, ItemStatus } from '@/lib/types';

// ── STATUS CONFIG ──────────────────────────────────────────────

const STATUS_CONFIG: Record<ItemStatus, {
  label: string;
  color: string;
  bg: string;
  border: string;
}> = {
  active: {
    label:  'Active',
    color:  COLORS.green,
    bg:     'rgba(72,200,120,0.1)',
    border: 'rgba(72,200,120,0.25)',
  },
  paused: {
    label:  'Paused',
    color:  COLORS.amber,
    bg:     'rgba(232,160,48,0.1)',
    border: 'rgba(232,160,48,0.25)',
  },
  waiting: {
    label:  'Waiting',
    color:  COLORS.teal,
    bg:     'rgba(56,184,200,0.1)',
    border: 'rgba(56,184,200,0.25)',
  },
  done: {
    label:  'Done',
    color:  'rgba(240,235,224,0.28)',
    bg:     'rgba(240,235,224,0.04)',
    border: 'rgba(240,235,224,0.1)',
  },
  dropped: {
    label:  'Dropped',
    color:  'rgba(240,235,224,0.20)',
    bg:     'rgba(240,235,224,0.03)',
    border: 'rgba(240,235,224,0.08)',
  },
};

// ── HELPERS ─────────────────────────────────────────────────────

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatDueAt(dueAt: string | null): string | null {
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

// ── COMPONENT ───────────────────────────────────────────────────

export default function ItemsSurface() {
  const supabase = createClient();

  const [userId, setUserId]   = useState<string | null>(null);
  const [items, setItems]     = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<string>('active');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('user_id', user.id)
        .order('last_activity_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setItems(data as ItemRow[]);
      }
    } catch (err) {
      console.error('ItemsSurface fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = filter === 'all'
    ? items
    : items.filter(i => i.status === filter);

  const filters = ['active', 'waiting', 'paused', 'done', 'all'] as const;

  return (
    <div style={{ padding: '4px 0', minHeight: 200 }}>
      {/* Filter chips */}
      <div style={{
        display: 'flex',
        gap: 6,
        padding: '0 16px 12px',
        flexWrap: 'wrap',
      }}>
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              border: `0.5px solid ${filter === f ? 'rgba(240,235,224,0.15)' : 'rgba(240,235,224,0.06)'}`,
              background: filter === f ? 'rgba(240,235,224,0.08)' : 'transparent',
              color: filter === f ? COLORS.textPrimary : COLORS.textMid,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: FONTS.sans,
              textTransform: 'capitalize',
              transition: `all ${TIMING.FAST}ms ${EASING.standard}`,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{
          textAlign: 'center',
          padding: '32px 0',
          color: COLORS.textLight,
          fontSize: 13,
          fontFamily: FONTS.sans,
        }}>
          Loading items...
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '32px 20px',
        }}>
          <div style={{
            fontFamily: FONTS.serif,
            fontSize: 18,
            fontWeight: 300,
            color: 'rgba(252,246,234,0.45)',
            lineHeight: 1.4,
          }}>
            {filter === 'all' ? 'No items yet.' : `No ${filter} items.`}
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.20)',
            lineHeight: 1.5,
            marginTop: 8,
          }}>
            Capture something to get started.
          </div>
        </div>
      )}

      {/* Item list */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 16px' }}>
          {filtered.map((item, i) => {
            const statusConfig = STATUS_CONFIG[item.status];
            const days = getDaysSince(item.last_activity_at);
            const due = formatDueAt(item.due_at);

            return (
              <div
                key={item.id}
                style={{
                  background: 'rgba(240,235,224,0.025)',
                  border: '0.5px solid rgba(240,235,224,0.04)',
                  borderRadius: 12,
                  padding: '10px 13px',
                  animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} ${i * 30}ms both`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.is_starred && (
                        <span style={{ fontSize: 11, color: COLORS.amber }}>★</span>
                      )}
                      <span style={{
                        fontSize: 13,
                        fontWeight: 400,
                        color: 'rgba(252,246,234,0.88)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                      }}>
                        {item.name}
                      </span>
                    </div>
                    {(item.category || item.notes) && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: 'rgba(240,235,224,0.28)',
                        marginTop: 2,
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {item.category ?? (item.notes ? item.notes.slice(0, 60) : '')}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {due && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: due === 'overdue' ? COLORS.red : COLORS.textMid,
                      }}>
                        {due}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10,
                      fontWeight: 500,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: statusConfig.bg,
                      border: `0.5px solid ${statusConfig.border}`,
                      color: statusConfig.color,
                    }}>
                      {statusConfig.label}
                    </span>
                    <span style={{
                      fontSize: 10,
                      color: COLORS.textLight,
                    }}>
                      {days === 0 ? 'today' : `${days}d`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
