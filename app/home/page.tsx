'use client';

import Logo from '@/components/ui/Logo';

export default function HomePage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: '#0D0F12', fontFamily: "'DM Sans', sans-serif" }}
    >
      <Logo light showWordmark />
      <p
        style={{
          marginTop: 24,
          fontSize: 14,
          fontWeight: 300,
          color: 'rgba(240,235,224,0.44)',
        }}
      >
        Authenticated. Home screen coming in Session 5.
      </p>
    </div>
  );
}
