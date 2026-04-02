// ── SESSION 19: ITEMS LIST PAGE ─────────────────────────────
// Route: /items
// Full item list — all items, clickable into item dashboard.
// Gateway from control panel navigation.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { useItems } from '@/lib/hooks/useItems';
import { COLORS, FONTS } from '@/lib/design-system';

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatRecency(dateStr: string): string {
  const days = getDaysSince(dateStr);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ItemsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
      } else {
        router.push('/');
      }
    });
  }, [router]);

  const { items, loading, error } = useItems(userId);

  const handleBack = () => {
    router.push('/home');
  };

  // ── LOADING ──────────────────────────────────────────────

  if (loading || !userId) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 14,
          color: COLORS.textLight,
          fontFamily: FONTS.sans,
        }}>
          Loading...
        </div>
      </div>
    );
  }

  // ── ERROR ────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <div style={{
          fontSize: 16,
          color: COLORS.textMid,
          fontFamily: FONTS.sans,
        }}>
          {error}
        </div>
        <button
          onClick={handleBack}
          style={{
            fontSize: 14,
            color: COLORS.teal,
            fontFamily: FONTS.sans,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px 16px',
          }}
        >
          Back to home
        </button>
      </div>
    );
  }

  // ── RENDER ───────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100dvh',
      background: COLORS.bg,
      fontFamily: FONTS.sans,
    }}>
      {/* Back navigation */}
      <button
        onClick={handleBack}
        style={{
          position: 'fixed',
          top: 16,
          left: 16,
          zIndex: 10,
          background: 'rgba(255,255,255,0.06)',
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 8,
          padding: '6px 14px',
          color: COLORS.textMid,
          fontSize: 13,
          fontFamily: FONTS.sans,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
      >
        Back
      </button>

      {/* Header */}
      <div style={{
        padding: '60px 20px 16px',
      }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 300,
          color: 'rgba(252,246,234,0.85)',
          fontFamily: FONTS.serif,
          letterSpacing: '0.3px',
          margin: 0,
        }}>
          Items
        </h1>
      </div>

      {/* Items list */}
      <div style={{
        padding: '0 16px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {items.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'rgba(240,235,224,0.30)',
            fontSize: 14,
          }}>
            No items yet.
          </div>
        ) : (
          items.map((item) => {
            const isDone = item.status === 'done' || item.status === 'dropped';
            const recency = formatRecency(item.last_activity_at);

            return (
              <div
                key={item.id}
                onClick={() => router.push(`/item/${item.id}`)}
                style={{
                  background: 'rgba(240,235,224,0.018)',
                  border: '0.5px solid rgba(240,235,224,0.035)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  opacity: isDone ? 0.5 : 1,
                  transition: 'opacity 200ms ease',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}>
                  {/* Name + category */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: isDone
                        ? 'rgba(252,246,234,0.45)'
                        : 'rgba(252,246,234,0.88)',
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.is_starred ? '★ ' : ''}{item.name}
                    </span>
                    {item.category && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: 'rgba(240,235,224,0.28)',
                        marginTop: 1,
                        display: 'block',
                      }}>
                        {item.category}
                      </span>
                    )}
                  </div>

                  {/* Recency */}
                  <span style={{
                    fontSize: 11,
                    fontWeight: 400,
                    color: 'rgba(240,235,224,0.35)',
                    flexShrink: 0,
                  }}>
                    {recency}
                  </span>

                  {/* Chevron */}
                  <span style={{
                    color: 'rgba(240,235,224,0.22)',
                    fontSize: 14,
                    flexShrink: 0,
                  }}>
                    ›
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
