'use client';

import { useMemo, useEffect, useRef } from 'react';
import { getSceneForHour } from '@/lib/design-system';
import { SCENE_HORIZON_PERCENT } from '@/lib/constants';

// Fixed star positions — generated once, never changes
const STARS = Array.from({ length: 26 }, (_, i) => ({
  id: i,
  x: ((i * 37 + 13) % 97),
  y: ((i * 23 + 7)  % 34),
  r: 0.4 + (i % 3) * 0.3,
  d: (i % 5) * 0.9,
}));

// ── CELESTIAL POSITION TYPE ──────────────────────────────
export type CelestialPosition = {
  /** Center X as CSS percentage string, e.g. "50%" */
  x: string;
  /** Center Y as CSS percentage string, e.g. "40%" */
  y: string;
  /** Whether the active scene shows the moon (not sun) */
  isMoon: boolean;
  /** Diameter of the rendered celestial object in px */
  size: number;
};

interface SceneBackgroundProps {
  onCelestialPosition?: (pos: CelestialPosition) => void;
}

export default function SceneBackground({ onCelestialPosition }: SceneBackgroundProps) {
  const h  = new Date().getHours();
  const sc = useMemo(() => getSceneForHour(h), [h]);

  const skyGradient   = `linear-gradient(to bottom, ${sc.sky.join(',')})`;
  const waterGradient = `linear-gradient(to bottom, ${sc.water.join(',')})`;

  // ── Sun rendering logic ──────────────────────────────────
  const isClipped = sc.sun.top >= 60 && sc.sun.opacity > 0;
  const isInSky   = sc.sun.top < 60 && sc.sun.opacity > 0;

  // Clipped sun params by period
  let clipSunSize = 0;
  let clipHalf = 0;
  let clipGradient = '';

  if (isClipped) {
    if (h >= 5 && h < 6) {
      // Pre-dawn
      clipSunSize = 44; clipHalf = 22;
      clipGradient = 'radial-gradient(circle,#fffee8 0%,#fee878 20%,#f8b030 42%,#ee7010 58%,rgba(220,100,20,0.18) 75%,transparent 100%)';
    } else if (h >= 6 && h < 8) {
      // Sunrise
      clipSunSize = 52; clipHalf = 26;
      clipGradient = 'radial-gradient(circle,#fffee8 0%,#fee870 22%,#f8b030 44%,#ee8010 60%,rgba(230,120,20,0.16) 76%,transparent 100%)';
    } else if (h >= 16 && h < 19) {
      // Golden hour
      clipSunSize = 60; clipHalf = 30;
      clipGradient = 'radial-gradient(circle,#fffee8 0%,#fee860 20%,#f8ac28 40%,#ee7808 55%,rgba(230,110,10,0.18) 72%,transparent 100%)';
    } else if (h >= 19 && h < 22) {
      // Dusk
      clipSunSize = 40; clipHalf = 20;
      clipGradient = 'radial-gradient(circle,#fff4d0 0%,#f8c060 24%,#f09020 44%,#cc6010 58%,rgba(190,80,15,0.16) 74%,transparent 100%)';
    }
  }

  // In-sky sun params
  let skySunSize = 0;
  let skySunShadow = '';
  if (isInSky) {
    if (h >= 8 && h < 11) {
      skySunSize = 32;
      skySunShadow = '0 0 20px 8px rgba(250,200,70,0.2)';
    } else if (h >= 11 && h < 16) {
      skySunSize = 28;
      skySunShadow = '0 0 18px 6px rgba(250,205,70,0.18)';
    }
  }

  // ── Compute actual rendered celestial center ────────────────
  // Moon: rendered at left:68% top:12% as top-left anchor, size 26px.
  //   Actual visual center = (68% + 13px, 12% + 13px).
  //   We report this as percentage offsets; the 13px correction is handled
  //   by the consumer since CSS calc() can mix units.
  //
  // Clipped sun: rendered inside a container of height SCENE_HORIZON_PERCENT%,
  //   positioned at bottom:-clipHalf, left:calc(50%-clipHalf).
  //   Its visual center is at the horizon line (SCENE_HORIZON_PERCENT%).
  //   Horizontal center: 50%.
  //
  // In-sky sun: rendered at left:50%, top:scene.sun.top% with translate(-50%,-50%).
  //   Visual center = (50%, scene.sun.top%).

  const MOON_SIZE = 26;

  // Use a ref to avoid re-calling callback with same values
  const lastReportedRef = useRef<string>('');

  useEffect(() => {
    if (!onCelestialPosition) return;

    let pos: CelestialPosition;

    if (sc.moon) {
      // Moon scene — report the visual center of the moon
      // The moon div is positioned at left:68% top:12% as top-left corner
      // Visual center needs +13px offset. We use a calc()-friendly format
      // so the consumer can use these directly in CSS.
      pos = {
        x: `calc(68% + ${MOON_SIZE / 2}px)`,
        y: `calc(12% + ${MOON_SIZE / 2}px)`,
        isMoon: true,
        size: MOON_SIZE,
      };
    } else if (isClipped && clipSunSize > 0) {
      // Clipped sun — center is at the horizon, horizontally centered
      pos = {
        x: '50%',
        y: `${SCENE_HORIZON_PERCENT}%`,
        isMoon: false,
        size: clipSunSize,
      };
    } else if (isInSky && skySunSize > 0) {
      // In-sky sun — center is at (50%, scene.sun.top%)
      pos = {
        x: '50%',
        y: `${sc.sun.top}%`,
        isMoon: false,
        size: skySunSize,
      };
    } else {
      // Fallback (sun below horizon, no moon) — not visible but report a sane default
      pos = {
        x: '50%',
        y: `${SCENE_HORIZON_PERCENT}%`,
        isMoon: false,
        size: 0,
      };
    }

    // Only fire callback if position actually changed
    const key = `${pos.x}|${pos.y}|${pos.isMoon}|${pos.size}`;
    if (key !== lastReportedRef.current) {
      lastReportedRef.current = key;
      onCelestialPosition(pos);
    }
  }, [sc, isClipped, isInSky, clipSunSize, skySunSize, onCelestialPosition]);

  return (
    <div className="fixed inset-0 overflow-hidden" aria-hidden="true">

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
              width: MOON_SIZE,
              height: MOON_SIZE,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 38% 36%, #f8f4e8, #d8ccb0)',
              boxShadow: '0 0 16px 6px rgba(220,200,160,0.18), 0 0 38px 12px rgba(180,160,120,0.09)',
            }}
          />
        </div>
      )}

      {/* Clipped sun — pre-dawn, sunrise, golden hour, dusk */}
      {isClipped && clipSunSize > 0 && (
        <div style={{
          position: 'absolute',
          left: 0, right: 0, top: 0,
          height: `${SCENE_HORIZON_PERCENT}%`,
          overflow: 'hidden',
          zIndex: 3,
          pointerEvents: 'none',
        }}>
          <div style={{
            position: 'absolute',
            left: `calc(50% - ${clipHalf}px)`,
            bottom: -clipHalf,
            width: clipSunSize,
            height: clipSunSize,
            borderRadius: '50%',
            background: clipGradient,
            animation: 'breath 9s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* In-sky sun — morning, midday */}
      {isInSky && skySunSize > 0 && (
        <div
          className="absolute"
          style={{
            left: '50%',
            top: `${sc.sun.top}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 3,
            animation: 'breath 9s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            width: skySunSize,
            height: skySunSize,
            borderRadius: '50%',
            background: 'radial-gradient(circle,#fffde8 0%,#fcd048 50%,#f0a020 100%)',
            boxShadow: skySunShadow,
          }} />
        </div>
      )}

      {/* Water / Ocean */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: `${SCENE_HORIZON_PERCENT}%`,
          background: waterGradient,
          zIndex: 2,
        }}
      >
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
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="mf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={sc.mf} />
            <stop offset="100%" stopColor={sc.mf} stopOpacity={0.85} />
          </linearGradient>
          <linearGradient id="mn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={sc.mn} />
            <stop offset="100%" stopColor={sc.mn} stopOpacity={0.85} />
          </linearGradient>
        </defs>
        {/* Far range */}
        <path
          d="M0,30 L0,18 C5,11 11,14 18,6 C25,-2 32,11 40,8 C48,5 54,14 62,10 C70,-4 78,9 86,7 C91,5 96,9 100,8 L100,30Z"
          fill="url(#mf)"
        />
        {/* Near range */}
        <path
          d="M0,30 L0,23 C4,17 9,20 15,13 C21,6 28,18 35,14 C42,10 48,19 56,15 C64,11 71,18 79,13 C84,9 91,14 98,15 L100,17 L100,30Z"
          fill="url(#mn)"
        />
      </svg>

    </div>
  );
}
