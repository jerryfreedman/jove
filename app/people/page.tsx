// ── SESSION 16: PEOPLE LIST PAGE ────────────────────────────
// Route: /people
// Loads all people with context and renders PeopleList (Rolodex).
// Follows the /item/[id]/page.tsx pattern for auth + loading.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { usePeopleWithContext } from '@/lib/hooks/usePeopleWithContext';
import PeopleList from '@/components/people/PeopleList';
import { COLORS, FONTS } from '@/lib/design-system';

export default function PeopleListPage() {
  const router = useRouter();

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

  const { people, loading, error } = usePeopleWithContext(userId);

  // ── BACK BUTTON ──────────────────────────────────────────

  const handleBack = () => {
    router.push('/home');
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

  // ── ERROR STATE ──────────────────────────────────────────

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

      <PeopleList people={people} />
    </div>
  );
}
