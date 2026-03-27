'use client';

import { useRouter } from 'next/navigation';
import Logo from '@/components/ui/Logo';

export default function AuthErrorPage() {
  const router = useRouter();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8"
      style={{ background: '#0D0F12', fontFamily: "'DM Sans', sans-serif" }}
    >
      <Logo light showWordmark size={32} />

      <p
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 28,
          fontWeight: 300,
          color: '#F0EBE0',
          marginTop: 32,
          marginBottom: 12,
          textAlign: 'center',
        }}
      >
        Something went wrong
      </p>

      <p
        style={{
          fontSize: 14,
          fontWeight: 300,
          color: 'rgba(240,235,224,0.52)',
          textAlign: 'center',
          marginBottom: 32,
          maxWidth: 280,
          lineHeight: 1.6,
        }}
      >
        We couldn&apos;t complete sign in. Please try again.
      </p>

      <button
        onClick={() => router.push('/')}
        style={{
          background: 'linear-gradient(135deg, #C87820, #E09838)',
          color: 'white',
          border: 'none',
          borderRadius: 12,
          padding: '13px 32px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '2px',
          textTransform: 'uppercase',
          cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
