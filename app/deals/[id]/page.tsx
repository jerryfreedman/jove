'use client';

import { useRouter } from 'next/navigation';

export default function DealDetailPage() {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight:  '100vh',
        background: '#F7F3EC',
        fontFamily: "'DM Sans', sans-serif",
        maxWidth:   390,
        margin:     '0 auto',
        padding:    '52px 20px 40px',
      }}
    >
      <button
        onClick={() => router.back()}
        style={{
          background:   'rgba(200,160,80,0.1)',
          border:       '0.5px solid rgba(200,160,80,0.22)',
          borderRadius: '50%',
          width:        34,
          height:       34,
          display:      'flex',
          alignItems:   'center',
          justifyContent:'center',
          cursor:       'pointer',
          color:        'rgba(26,20,16,0.5)',
          fontSize:     19,
          marginBottom: 28,
        }}
      >
        ‹
      </button>
      <p style={{
        fontFamily:   "'Cormorant Garamond', serif",
        fontSize:     26,
        fontWeight:   300,
        color:        '#1A1410',
        marginBottom: 8,
      }}>
        Deal detail
      </p>
      <p style={{
        fontSize:   13,
        fontWeight: 300,
        color:      'rgba(26,20,16,0.44)',
        lineHeight: 1.6,
      }}>
        Full deal drawer with contacts, history, and AI actions
        coming in Session 9.
      </p>
    </div>
  );
}
