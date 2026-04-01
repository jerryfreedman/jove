'use client';

// ── SESSION 12C: ZERO-FRICTION ONBOARDING ──────────────────
// No questions. No setup steps. No "What do you sell?"
// User arrives → we mark onboarding complete → redirect to /home.
// Value starts immediately from the first thing they type.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import Logo from '@/components/ui/Logo';
import { getGreeting, getSceneForHour, COLORS } from '@/lib/design-system';

export default function OnboardingPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [visible, setVisible]           = useState(false);
  const [readyFadingOut, setReadyFadingOut] = useState(false);
  const [user, setUser]                 = useState<any>(null);
  const [error, setError]               = useState('');
  const completedRef = useRef(false);

  const h     = new Date().getHours();
  const scene = getSceneForHour(h);

  // On mount: mark onboarding complete immediately, then show "You're ready."
  useEffect(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    const completeOnboarding = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) throw new Error('No user session');
        setUser(authUser);

        // Mark onboarding complete — no questions needed
        const { error: userError } = await supabase
          .from('users')
          .update({ onboarding_completed: true })
          .eq('id', authUser.id);

        if (userError) throw userError;

        // Create voice profile row (empty — learns over time)
        await supabase
          .from('voice_profile')
          .upsert({
            user_id:      authUser.id,
            sample_count: 0,
          }, { onConflict: 'user_id', ignoreDuplicates: true });

        // Show the "You're ready" moment, then redirect
        setVisible(true);
        setTimeout(() => setReadyFadingOut(true), 2200);
        setTimeout(() => router.push('/home'), 2800);
      } catch (err) {
        console.error('Onboarding error:', err);
        setError('Something went wrong. Please refresh.');
      }
    };

    completeOnboarding();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      <SceneBackground />

      {/* "You're ready." overlay — the only onboarding experience */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{
          zIndex:     100,
          background: 'rgba(13,15,18,0.92)',
          opacity:    readyFadingOut ? 0 : (visible ? 1 : 1),
          transition: 'opacity 0.6s ease',
        }}
      >
        <div style={{ animation: 'breath 5s ease-in-out infinite', marginBottom: 28 }}>
          <Logo light showWordmark={false} size={80} onClick={() => {}} />
        </div>
        <p
          style={{
            fontFamily:    "'Cormorant Garamond', serif",
            fontSize:      32,
            fontWeight:    300,
            color:         'rgba(252,246,234,0.94)',
            letterSpacing: '0.5px',
            animation:     'fadeUp 0.7s ease both',
            animationDelay:'0.3s',
            opacity:       0,
          }}
        >
          {(() => {
            const fullName = user?.user_metadata?.full_name
              ?? user?.user_metadata?.name
              ?? '';
            const firstName = fullName.split(' ')[0] ?? '';
            return firstName ? `You're ready, ${firstName}.` : "You're ready.";
          })()}
        </p>
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
