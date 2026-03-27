'use client';

import { useRouter } from 'next/navigation';
import Logo from '@/components/ui/Logo';

export default function BriefingPage() {
  const router = useRouter();
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8"
      style={{
        background: '#F7F3EC',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <Logo showWordmark size={28} />
      <p style={{
        fontFamily:   "'Cormorant Garamond', serif",
        fontSize:     28,
        fontWeight:   300,
        color:        '#1A1410',
        marginTop:    28,
        marginBottom: 12,
        textAlign:    'center',
      }}>
        Today&apos;s Briefing
      </p>
      <p style={{
        fontSize:    14,
        fontWeight:  300,
        color:       'rgba(26,20,16,0.44)',
        textAlign:   'center',
        marginBottom:32,
        maxWidth:    260,
        lineHeight:  1.6,
      }}>
        Full briefing experience coming in Session 10.
      </p>
      <button
        onClick={() => router.back()}
        style={{
          background:    'transparent',
          border:        '0.5px solid rgba(26,20,16,0.2)',
          borderRadius:  12,
          padding:       '12px 28px',
          fontSize:      11,
          fontWeight:    700,
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color:         'rgba(26,20,16,0.5)',
          cursor:        'pointer',
          fontFamily:    "'DM Sans', sans-serif",
        }}
      >
        ← Back
      </button>
    </div>
  );
}
