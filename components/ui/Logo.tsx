'use client';

import { useRouter } from 'next/navigation';
import { COLORS } from '@/lib/design-system';

interface LogoProps {
  light?: boolean;   // true = logo on dark background (home screen)
  size?:  number;    // default 30
  showWordmark?: boolean; // default true
  onClick?: () => void;  // override default settings navigation
}

export default function Logo({
  light = false,
  size = 30,
  showWordmark = true,
  onClick,
}: LogoProps) {
  const router = useRouter();

  const strokeColor = light
    ? 'rgba(255,248,230,0.38)'
    : 'rgba(26,20,16,0.38)';

  const nameColor = light
    ? 'rgba(255,248,230,0.36)'
    : 'rgba(26,20,16,0.38)';

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.push('/settings');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 cursor-pointer select-none
                 bg-transparent border-none p-0 animate-breath"
      style={{ WebkitTapHighlightColor: 'transparent' }}
      aria-label="Jove — open settings"
    >
      {/* Logo mark: circle + horizon + sun */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.2))',
          flexShrink: 0,
        }}
      >
        {/* Outer circle */}
        <circle
          cx="16"
          cy="16"
          r="13.5"
          stroke={strokeColor}
          strokeWidth="1.4"
          fill="none"
        />
        {/* Horizon line */}
        <line
          x1="3.5"
          y1="19.5"
          x2="28.5"
          y2="19.5"
          stroke={strokeColor}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* Sun glow — pulses independently */}
        <circle
          cx="16"
          cy="14.5"
          r="5.5"
          fill="rgba(232,160,48,0.1)"
          className="animate-sun-glow"
        />
        {/* Sun core — pulses independently */}
        <circle
          cx="16"
          cy="14.5"
          r="2.8"
          fill="rgba(232,160,48,0.92)"
          className="animate-sun-pulse"
        />
      </svg>

      {/* Wordmark */}
      {showWordmark && (
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '3.5px',
            textTransform: 'uppercase',
            color: nameColor,
            textShadow: light ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
          }}
        >
          Jove
        </span>
      )}
    </button>
  );
}
