// ── SESSION 16: PEOPLE LIST (ROLODEX) ───────────────────────
// Scrollable list of all people with search.
// Each row shows: name, summary context, state, last interaction.
// Sorted by: 1) recent interaction, 2) stale priority.
// Click → navigates to /people/[id].
// Follows the same glass UI as ItemDashboard / ControlSurface.

'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { COLORS, FONTS, TIMING, EASING } from '@/lib/design-system';
import { buildPersonIntelligence } from '@/lib/intelligence/personIntelligence';
import type { PersonWithContext } from '@/lib/hooks/usePeopleWithContext';

// ── STATE HELPERS ──────────────────────────────────────────

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

// ── COMPONENT ──────────────────────────────────────────────

interface PeopleListProps {
  people: PersonWithContext[];
}

export default function PeopleList({ people }: PeopleListProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  // Compute intelligence for each person + filter + sort
  const enriched = useMemo(() => {
    const now = new Date();

    return people
      .map(person => {
        const intel = buildPersonIntelligence(person.name, {
          interactions: person.interactions,
          items: person.items,
          now,
        });
        return { person, intel };
      })
      .filter(({ person }) => {
        if (!search) return true;
        return person.name.toLowerCase().includes(search.toLowerCase());
      })
      .sort((a, b) => {
        // Stale people surface first for reconnect priority
        const staleOrder = { stale: 0, unknown: 1, active: 2, normal: 3 };
        const aStale = staleOrder[a.intel.state] ?? 4;
        const bStale = staleOrder[b.intel.state] ?? 4;

        // If one is stale and other isn't, stale first
        if (a.intel.state === 'stale' && b.intel.state !== 'stale') return -1;
        if (b.intel.state === 'stale' && a.intel.state !== 'stale') return 1;

        // Then by recency (most recent first)
        const aTime = a.person.last_interaction_at
          ? new Date(a.person.last_interaction_at).getTime()
          : new Date(a.person.created_at).getTime();
        const bTime = b.person.last_interaction_at
          ? new Date(b.person.last_interaction_at).getTime()
          : new Date(b.person.created_at).getTime();
        return bTime - aTime;
      });
  }, [people, search]);

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
      <div style={{ paddingTop: 60, marginBottom: 20 }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 500,
          fontFamily: FONTS.serif,
          color: COLORS.textPrimary,
          margin: 0,
          lineHeight: 1.3,
        }}>
          People
        </h1>
        <div style={{
          fontSize: 12,
          color: COLORS.textLight,
          marginTop: 4,
        }}>
          {people.length} {people.length === 1 ? 'person' : 'people'}
        </div>
      </div>

      {/* ── SEARCH ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: 14,
            fontFamily: FONTS.sans,
            color: COLORS.textPrimary,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* ── LIST ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {enriched.map(({ person, intel }) => (
          <div
            key={person.id}
            onClick={() => router.push(`/people/${person.id}`)}
            style={{
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 8,
              border: `1px solid ${COLORS.cardBorder}`,
              cursor: 'pointer',
              transition: `border-color ${TIMING.FAST}ms ${EASING.gentle}`,
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}>
              {/* Name */}
              <span style={{
                fontSize: 15,
                fontWeight: 500,
                color: COLORS.textPrimary,
              }}>
                {person.name}
              </span>

              {/* Last interaction time */}
              <span style={{
                fontSize: 11,
                color: COLORS.textLight,
                flexShrink: 0,
                marginLeft: 12,
              }}>
                {intel.lastInteraction}
              </span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              {/* Summary / relationship */}
              <span style={{
                fontSize: 12,
                color: COLORS.textMid,
                flex: 1,
              }}>
                {intel.summary}
              </span>

              {/* State badge */}
              <span style={{
                fontSize: 10,
                fontWeight: 500,
                color: stateColor(intel.state),
                background: `${stateColor(intel.state)}18`,
                padding: '1px 6px',
                borderRadius: 3,
                flexShrink: 0,
              }}>
                {stateLabel(intel.state)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── EMPTY STATE ─────────────────────────────────────── */}
      {enriched.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '48px 20px',
          color: COLORS.textLight,
          fontSize: 14,
        }}>
          {search ? 'No people matching that name.' : 'No people yet.'}
        </div>
      )}
    </div>
  );
}
