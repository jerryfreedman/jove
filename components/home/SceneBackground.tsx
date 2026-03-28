'use client';

import { useMemo } from 'react';
import { getSceneForHour } from '@/lib/design-system';

// Fixed star positions — generated once, never changes
const STARS = Array.from({ length: 26 }, (_, i) => ({
  id: i,
  x: ((i * 37 + 13) % 97),
  y: ((i * 23 + 7)  % 34),
  r: 0.4 + (i % 3) * 0.3,
  d: (i % 5) * 0.9,
}));

export default function SceneBackground() {
  const h  = new Date().getHours();
  const sc = useMemo(() => getSceneForHour(h), [h]);

  const skyGradient   = `linear-gradient(to bottom, ${sc.sky.join(',')})`;
  const waterGradient = `linear-gradient(to bottom, ${sc.water.join(',')})`;
  const skyBottom     = sc.sky[sc.sky.length - 1];
  const isSetting     = sc.sun.top > 65;
  const sunSize       = isSetting ? 26 : 44;

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">

      {/* Sky */}
      <div
        className="absolute inset-0"
        style={{ background: skyGradient }}
      />

      {/* Stars — visible only at night/dawn/dusk */}
      {sc.stars > 0 && (
        <svg
          className="absolute top-0 left-0 w-full pointer-events-none"
          style={{ height: '38%', opacity: sc.stars }}
          viewBox="0 0 390 200"
          preserveAspectRatio="xMidYMid slice"
        >
          {STARS.map(s => (
            <circle
              key={s.id}
              cx={`${s.x}%`}
              cy={s.y * 5.5}
              r={s.r}
              fill="white"
              style={{
                animation: `starTwink ${2.8 + s.d}s ease-in-out infinite`,
                animationDelay: `${s.d}s`,
              }}
            />
          ))}
        </svg>
      )}

      {/* Moon — deep night only */}
      {sc.moon && (
        <div
          className="absolute"
          style={{
            left: '68%',
            top:  '12%',
            zIndex: 3,
            animation: 'breath 12s ease-in-out infinite',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 38% 36%, #f8f4e8, #d8ccb0)',
              boxShadow: '0 0 16px 6px rgba(220,200,160,0.18), 0 0 38px 12px rgba(180,160,120,0.09)',
            }}
          />
        </div>
      )}

      {/* Atmospheric haze at horizon */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '42%',
          left: 0,
          right: 0,
          height: 220,
          background: `radial-gradient(ellipse 82% 60% at 50% 0%, ${sc.haze}, transparent)`,
          transform: 'translateY(-16%)',
          animation: 'hazeBreath 10s ease-in-out infinite',
        }}
      />

      {/* Sun */}
      {sc.sun.opacity > 0 && (
        <div
          className="absolute"
          style={{
            left: '50%',
            top: `${sc.sun.top}%`,
            transform: 'translate(-50%, -50%)',
            opacity: sc.sun.opacity,
            zIndex: 3,
            animation: 'breath 9s ease-in-out infinite',
          }}
        >
          {/* Outer glow */}
          <div style={{
            position: 'absolute',
            inset: isSetting ? -30 : -22,
            borderRadius: '50%',
            background: isSetting
              ? 'radial-gradient(circle, rgba(248,200,80,0.18), rgba(240,158,48,0.06) 50%, transparent 70%)'
              : 'radial-gradient(circle, rgba(248,200,80,0.12), rgba(240,158,48,0.04) 55%, transparent 70%)',
          }} />
          {/* Mid glow */}
          <div style={{
            position: 'absolute',
            inset: isSetting ? -12 : -9,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(248,188,70,0.2), transparent 70%)',
          }} />
          {/* Sun body */}
          <div style={{
            width: sunSize,
            height: sunSize,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 38% 36%, #FFFCE0, #F8C040)',
            boxShadow: isSetting
              ? '0 0 36px 14px rgba(248,190,64,0.30)'
              : '0 0 28px 10px rgba(248,190,64,0.24)',
          }} />
        </div>
      )}

      {/* Water / Ocean */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: '60%',
          background: waterGradient,
          zIndex: 2,
        }}
      >
        {/* Sky-to-water horizon blend */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 40,
          background: `linear-gradient(to bottom, ${skyBottom}, transparent)`,
          pointerEvents: 'none',
        }} />
        {/* Horizon shimmer line */}
        <div style={{
          position: 'absolute',
          top: 40,
          left: '5%',
          right: '5%',
          height: 1,
          background: 'linear-gradient(to right, transparent, rgba(255,230,150,0.36), transparent)',
        }} />
        {/* Sun reflection column */}
        <div style={{
          position: 'absolute',
          top: 2,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 28,
          height: 58,
          background: 'linear-gradient(to bottom, rgba(255,228,148,0.15), transparent)',
          borderRadius: '0 0 50% 50%',
          filter: 'blur(6px)',
          animation: 'reflGlow 7s ease-in-out infinite',
        }} />
        {/* Waves */}
        {[18, 42, 68].map((top, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top,
              left: -24,
              right: -24,
              height: 1,
              borderRadius: '50%',
              background: `rgba(255,220,140,${0.1 - i * 0.024})`,
              animation: `waveFlow ${13 + i * 4}s ease-in-out infinite`,
              animationDelay: `${i * 2.6}s`,
            }}
          />
        ))}
      </div>

      {/* Mountains — SVG, warm earth tones, two ranges */}
      <svg
        className="absolute bottom-0 left-0 w-full pointer-events-none"
        style={{ zIndex: 5 }}
        viewBox="0 0 390 90"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="mf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={sc.mf} />
            <stop offset="100%" stopColor={sc.mf} stopOpacity={0.75} />
          </linearGradient>
          <linearGradient id="mn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={sc.mn} />
            <stop offset="100%" stopColor={sc.mn} stopOpacity={0.88} />
          </linearGradient>
        </defs>
        {/* Far range */}
        <path
          d="M0,90 L0,56 C24,34 48,48 76,20 C104,-8 132,38 162,26 C192,14 220,44 250,18 C280,-8 308,34 336,28 C356,24 374,36 390,38 L390,90 Z"
          fill="url(#mf)"
        />
        {/* Near range */}
        <path
          d="M0,90 L0,72 C18,54 38,64 62,42 C86,20 110,54 138,44 C166,34 190,58 218,46 C246,34 270,52 296,36 C316,24 340,42 366,48 L390,52 L390,90 Z"
          fill="url(#mn)"
        />
      </svg>

    </div>
  );
}
