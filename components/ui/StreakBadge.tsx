'use client';

import { getStreakArcPercent, COLORS } from '@/lib/design-system';

interface StreakBadgeProps {
  days:  number;
  light?: boolean; // true = on dark background
}

export default function StreakBadge({ days, light = false }: StreakBadgeProps) {
  const pct    = getStreakArcPercent(days);
  const R      = 9;
  const circ   = 2 * Math.PI * R;
  const filled = circ * (pct / 100);
  const gap    = circ - filled;

  const bgColor     = light ? 'rgba(255,252,244,0.15)' : 'rgba(255,252,244,0.55)';
  const borderColor = light ? 'rgba(200,136,32,0.3)'   : 'rgba(200,136,32,0.22)';
  const labelColor  = light ? 'rgba(255,248,230,0.5)'  : 'rgba(26,20,16,0.5)';

  return (
    <div
      className="flex items-center gap-[7px] rounded-[20px] px-3 py-[5px]"
      style={{
        background:     bgColor,
        border:         `0.5px solid ${borderColor}`,
        backdropFilter: 'blur(8px)',
        paddingLeft:    7,
      }}
    >
      {/* Arc ring */}
      <div className="relative w-[22px] h-[22px] flex items-center justify-center"
           style={{ flexShrink: 0 }}>
        <svg
          className="absolute inset-0"
          viewBox="0 0 22 22"
          style={{ overflow: 'visible' }}
        >
          {/* Track */}
          <circle
            cx="11" cy="11" r={R}
            stroke="rgba(200,136,32,0.12)"
            strokeWidth="2"
            fill="none"
          />
          {/* Fill */}
          <circle
            cx="11" cy="11" r={R}
            stroke="rgba(200,136,32,0.65)"
            strokeWidth="2"
            fill="none"
            strokeDasharray={`${filled} ${gap}`}
            strokeDashoffset={circ * 0.25}
            strokeLinecap="round"
            transform="rotate(-90 11 11)"
          />
        </svg>
        {/* Day count */}
        <span style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'rgba(200,136,32,0.95)',
          fontFamily: "'DM Sans', sans-serif",
          position: 'relative',
          zIndex: 1,
        }}>
          {days}
        </span>
      </div>

      {/* Label */}
      <span style={{
        fontSize: 10,
        fontWeight: 300,
        color: labelColor,
        fontFamily: "'DM Sans', sans-serif",
      }}>
        day streak
      </span>
    </div>
  );
}
