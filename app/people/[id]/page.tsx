// ── SESSION 16: PERSON DETAIL PAGE ──────────────────────────
// Route: /people/[id]
// Loads a single person with context and renders PersonProfile.
// Follows the /item/[id]/page.tsx pattern for auth + loading.

'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { usePeopleWithContext } from '@/lib/hooks/usePeopleWithContext';
import PersonProfile from '@/components/people/PersonProfile';
import { COLORS, FONTS } from '@/lib/design-system';

export default function PersonDetailPage() {
  const params = useParams();
  const router = useRouter();
  const personId = typeof params.id === 'string' ? params.id : null;

  // Get current user
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

  // Fetch all people with context, then find the one we need
  const { people, loading, error } = usePeopleWithContext(userId);

  const person = useMemo(() => {
    if (!personId) return null;
    return people.find(p => p.id === personId) ?? null;
  }, [people, personId]);

  // ── BACK BUTTON ──────────────────────────────────────────

  const handleBack = () => {
    router.push('/people');
  };

  // ── LOADING STATE ────────────────────────────────────────

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

  // ── ERROR / NOT FOUND ────────────────────────────────────

  if (error || !person) {
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
          {error ?? 'Person not found'}
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
          Back to people
        </button>
      </div>
    );
  }

  // ── RENDER ───────────────────────────────────────────────

  return (
    <div style={{ position: 'relative' }}>
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

      <PersonProfile person={person} />
    </div>
  );
}
