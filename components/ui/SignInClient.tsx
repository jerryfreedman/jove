'use client';

import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import Logo from '@/components/ui/Logo';

export default function SignInClient() {
  const supabase = createClient();

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      <SceneBackground />

      {/* UI layer */}
      <div
        className="relative z-10 flex flex-col items-center justify-center
                    min-h-screen px-8"
      >
        {/* Logo mark — no wordmark, larger */}
        <div
          style={{
            marginBottom: 24,
            animation: 'breath 5s ease-in-out infinite',
          }}
        >
          <Logo light showWordmark={false} size={52} onClick={() => {}} />
        </div>

        {/* App name */}
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            color: 'rgba(255,248,230,0.38)',
            marginBottom: 16,
            textShadow: '0 1px 4px rgba(0,0,0,0.3)',
          }}
        >
          Jove
        </p>

        {/* Tagline */}
        <h1
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 38,
            fontWeight: 300,
            color: 'rgba(252,246,234,0.94)',
            textAlign: 'center',
            lineHeight: 1.15,
            letterSpacing: '-0.3px',
            textShadow: '0 2px 24px rgba(0,0,0,0.18)',
            marginBottom: 10,
            maxWidth: 280,
          }}
        >
          Your intelligence,
          <br />
          compounding daily.
        </h1>

        {/* Sub-tagline */}
        <p
          style={{
            fontSize: 14,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.44)',
            textAlign: 'center',
            marginBottom: 48,
            maxWidth: 240,
            lineHeight: 1.55,
          }}
        >
          For sales professionals who take their craft seriously.
        </p>

        {/* Google sign in button */}
        <button
          onClick={handleGoogleSignIn}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(255,252,244,0.95)',
            border: '0.5px solid rgba(200,160,80,0.3)',
            borderRadius: 14,
            padding: '14px 28px',
            cursor: 'pointer',
            boxShadow: '0 6px 28px rgba(0,0,0,0.25)',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s ease',
            fontFamily: "'DM Sans', sans-serif",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
          }}
        >
          {/* Google G */}
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1A1410',
              letterSpacing: '0.2px',
            }}
          >
            Continue with Google
          </span>
        </button>

        {/* Legal */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.28)',
            textAlign: 'center',
            marginTop: 24,
            maxWidth: 260,
            lineHeight: 1.5,
          }}
        >
          Your data is private to your account.
          <br />
          No data is ever shared between users.
        </p>
      </div>
    </div>
  );
}
