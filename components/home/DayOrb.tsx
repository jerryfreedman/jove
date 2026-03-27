// NOTE: No longer used on home screen as of
// Sun Orb Unification. Retained for potential reuse.

'use client';

import { getDayIntensity } from '@/lib/design-system';

interface DayOrbProps {
  meetingCount:  number;
  urgentDeals:   number;
  onClick:       () => void;
}

export default function DayOrb({ meetingCount, urgentDeals, onClick }: DayOrbProps) {
  const total     = meetingCount + urgentDeals;
  const intensity = getDayIntensity(total);

  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center cursor-pointer
                 bg-transparent border-none p-0"
      style={{
        width:  110,
        height: 110,
        WebkitTapHighlightColor: 'transparent',
      }}
      aria-label={`${intensity.label} day — ${meetingCount} meetings. Tap for briefing.`}
    >
      {/* Outer glow halo */}
      <div
        className="absolute animate-orb-glow"
        style={{
          inset: -14,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${intensity.glow}, transparent 68%)`,
        }}
      />

      {/* Outer ring trace */}
      <div
        className="absolute inset-0 animate-breath"
        style={{
          borderRadius: '50%',
          border: `1.5px solid ${intensity.color}1a`,
        }}
      />

      {/* Core orb */}
      <div
        className="animate-orb-pulse"
        style={{
          width:        74,
          height:       74,
          borderRadius: '50%',
          background:   `radial-gradient(circle at 36% 34%, ${intensity.color}f0, ${intensity.color}88)`,
          boxShadow:    `0 0 24px 8px ${intensity.glow}, 0 4px 20px rgba(0,0,0,0.28)`,
          display:      'flex',
          flexDirection:'column',
          alignItems:   'center',
          justifyContent:'center',
          position:     'relative',
          zIndex:       1,
        }}
      >
        <span style={{
          fontSize:   24,
          fontWeight: 300,
          color:      'white',
          lineHeight: 1,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {meetingCount}
        </span>
        <span style={{
          fontSize:      7,
          fontWeight:    600,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color:         'rgba(255,255,255,0.62)',
          marginTop:     1,
          fontFamily:    "'DM Sans', sans-serif",
        }}>
          meetings
        </span>
      </div>
    </button>
  );
}
