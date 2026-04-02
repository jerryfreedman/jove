'use client';

// ── SESSION 10: DOMAIN ONBOARDING ─────────────────────────
// One lightweight question: "What will you use Jove for?"
// One-tap selection → persist domain_key → mark complete → /home.
// Preserves the zero-friction philosophy from Session 12C.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import Logo from '@/components/ui/Logo';
import { COLORS } from '@/lib/design-system';
import { DOMAIN_CHOICES, DEFAULT_DOMAIN_KEY } from '@/lib/domain';
import type { UserDomainKey } from '@/lib/types';

export default function OnboardingPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [phase, setPhase]       = useState<'choose' | 'completing' | 'ready'>('choose');
  const [visible, setVisible]   = useState(false);
  const [readyFadingOut, setReadyFadingOut] = useState(false);
  const [user, setUser]         = useState<any>(null);
  const [error, setError]       = useState('');
  const completingRef           = useRef(false);

  // Fetch user on mount (for name display)
  useEffect(() => {
    const loadUser = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) setUser(authUser);
    };
    loadUser();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Domain selection handler ─────────────────────────────
  const handleDomainSelect = async (domainKey: UserDomainKey) => {
    if (completingRef.current) return;
    completingRef.current = true;
    setPhase('completing');

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('No user session');
      setUser(authUser);

      // Persist domain_key + mark onboarding complete in one update
      const { error: userError } = await supabase
        .from('users')
        .update({
          domain_key: domainKey,
          onboarding_completed: true,
        })
        .eq('id', authUser.id);

      if (userError) throw userError;

      console.log('[onboarding] domain selected:', domainKey, 'user:', authUser.id);

      // Create voice profile row (empty — learns over time)
      await supabase
        .from('voice_profile')
        .upsert({
          user_id:      authUser.id,
          sample_count: 0,
        }, { onConflict: 'user_id', ignoreDuplicates: true });

      // Show "You're ready." moment, then redirect
      setPhase('ready');
      setVisible(true);
      setTimeout(() => setReadyFadingOut(true), 2200);
      setTimeout(() => router.push('/home'), 2800);
    } catch (err) {
      console.error('Onboarding error:', err);
      setError('Something went wrong. Please refresh.');
      completingRef.current = false;
      setPhase('choose');
    }
  };

  const firstName = (() => {
    const fullName = user?.user_metadata?.full_name
      ?? user?.user_metadata?.name
      ?? '';
    return fullName.split(' ')[0] ?? '';
  })();

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      <SceneBackground />

      {/* ── PHASE 1: Domain selection ── */}
      {phase === 'choose' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center px-6"
          style={{
            zIndex: 105,
            background: 'rgba(13,15,18,0.92)',
            animation: 'fadeUp 0.5s ease both',
          }}
        >
          <div style={{ animation: 'breath 5s ease-in-out infinite', marginBottom: 32 }}>
            <Logo light showWordmark={false} size={64} onClick={() => {}} />
          </div>

          <p
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 26,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.94)',
              letterSpacing: '0.3px',
              marginBottom: 32,
              textAlign: 'center',
            }}
          >
            {firstName ? `What will you use Jove for, ${firstName}?` : 'What will you use Jove for?'}
          </p>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',
            maxWidth: 400,
          }}>
            {DOMAIN_CHOICES.map((choice) => (
              <button
                key={choice.label}
                onClick={() => handleDomainSelect(choice.domainKey)}
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 15,
                  fontWeight: 400,
                  color: 'rgba(252,246,234,0.9)',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  padding: '12px 22px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backdropFilter: 'blur(8px)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }}
              >
                {choice.label}
              </button>
            ))}
          </div>

          {error && (
            <p style={{
              fontSize: 13,
              color: COLORS.red,
              marginTop: 16,
              fontWeight: 300,
            }}>
              {error}
            </p>
          )}
        </div>
      )}

      {/* ── PHASE 2: Completing (brief transition) ── */}
      {phase === 'completing' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            zIndex: 105,
            background: 'rgba(13,15,18,0.92)',
          }}
        >
          <div style={{ animation: 'breath 5s ease-in-out infinite' }}>
            <Logo light showWordmark={false} size={80} onClick={() => {}} />
          </div>
        </div>
      )}

      {/* ── PHASE 3: "You're ready." moment ── */}
      {phase === 'ready' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            zIndex: 105,
            background: 'rgba(13,15,18,0.92)',
            opacity: readyFadingOut ? 0 : (visible ? 1 : 1),
            transition: 'opacity 0.6s ease',
          }}
        >
          <div style={{ animation: 'breath 5s ease-in-out infinite', marginBottom: 28 }}>
            <Logo light showWordmark={false} size={80} onClick={() => {}} />
          </div>
          <p
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 32,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.94)',
              letterSpacing: '0.5px',
              animation: 'fadeUp 0.7s ease both',
              animationDelay: '0.3s',
              opacity: 0,
            }}
          >
            {firstName ? `You're ready, ${firstName}.` : "You're ready."}
          </p>
        </div>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes breath {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
