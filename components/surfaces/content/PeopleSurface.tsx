// ── SESSION 9: PEOPLE SURFACE ───────────────────────────────
// Minimal surface for viewing user's people.
// Operational, not overdesigned. Follows IdeasSurface pattern.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { COLORS, FONTS, TIMING, EASING } from '@/lib/design-system';
import type { PersonRow } from '@/lib/types';

// ── HELPERS ─────────────────────────────────────────────────────

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ── COMPONENT ───────────────────────────────────────────────────

export default function PeopleSurface() {
  const supabase = createClient();

  const [people, setPeople]   = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        // Sort: most recently interacted first
        const sorted = (data as PersonRow[]).sort((a, b) => {
          const aTime = a.last_interaction_at
            ? new Date(a.last_interaction_at).getTime()
            : new Date(a.created_at).getTime();
          const bTime = b.last_interaction_at
            ? new Date(b.last_interaction_at).getTime()
            : new Date(b.created_at).getTime();
          return bTime - aTime;
        });
        setPeople(sorted);
      }
    } catch (err) {
      console.error('PeopleSurface fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div style={{ padding: '4px 0', minHeight: 200 }}>
      {/* Loading state */}
      {loading && (
        <div style={{
          textAlign: 'center',
          padding: '32px 0',
          color: COLORS.textLight,
          fontSize: 13,
          fontFamily: FONTS.sans,
        }}>
          Loading people...
        </div>
      )}

      {/* Empty state */}
      {!loading && people.length === 0 && (
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
            No people yet.
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.20)',
            lineHeight: 1.5,
            marginTop: 8,
          }}>
            Mention someone in a capture to add them.
          </div>
        </div>
      )}

      {/* People list */}
      {!loading && people.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 16px' }}>
          {people.map((person, i) => {
            const days = person.last_interaction_at
              ? getDaysSince(person.last_interaction_at)
              : null;
            const isStale = days !== null && days > 14;

            return (
              <div
                key={person.id}
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
                    <span style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: 'rgba(252,246,234,0.88)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}>
                      {person.name}
                    </span>
                    {(person.relationship || person.notes) && (
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
                        {person.relationship ?? (person.notes ? person.notes.slice(0, 60) : '')}
                      </span>
                    )}
                    {person.email && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 400,
                        color: 'rgba(240,235,224,0.18)',
                        marginTop: 1,
                        display: 'block',
                      }}>
                        {person.email}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {days !== null && (
                      <span style={{
                        fontSize: 10,
                        color: isStale ? COLORS.amber : COLORS.textLight,
                      }}>
                        {days === 0 ? 'today' : `${days}d ago`}
                      </span>
                    )}
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
