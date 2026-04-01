'use client';

import { useState, useEffect, useRef } from 'react';
import { SCENE_HORIZON_PERCENT } from '@/lib/constants';
import {
  getFractionalHour,
  getScenePair,
  blendScenes,
} from '@/lib/scene-interpolation';
import { initSolarTime, isSolarInitialized } from '@/lib/solar-time';
import type { SceneConfig } from '@/lib/design-system';

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

// ── CELESTIAL PARAMS ─────────────────────────────────────
// Maps scene boundary hours to their celestial rendering params.
// These define the sun/moon appearance at each scene "keyframe".
// The interpolation engine blends between them.

type CelestialKeyframe = {
  mode: 'moon' | 'clipped' | 'inSky' | 'hidden';
  size: number;
  gradient: string;
  shadow: string;
};

const CELESTIAL_KEYFRAMES: Record<number, CelestialKeyframe> = {
  // Deep night (hour 0 / 22) — moon
  0: { mode: 'moon', size: 26, gradient: '', shadow: '' },
  22: { mode: 'moon', size: 26, gradient: '', shadow: '' },
  // Pre-dawn
  5: {
    mode: 'clipped', size: 44,
    gradient: 'radial-gradient(circle,#fffee8 0%,#fee878 20%,#f8b030 42%,#ee7010 58%,rgba(220,100,20,0.18) 75%,transparent 100%)',
    shadow: '',
  },
  // Sunrise
  6: {
    mode: 'clipped', size: 52,
    gradient: 'radial-gradient(circle,#fffee8 0%,#fee870 22%,#f8b030 44%,#ee8010 60%,rgba(230,120,20,0.16) 76%,transparent 100%)',
    shadow: '',
  },
  // Morning
  8: {
    mode: 'inSky', size: 32,
    gradient: 'radial-gradient(circle,#fffde8 0%,#fcd048 50%,#f0a020 100%)',
    shadow: '0 0 20px 8px rgba(250,200,70,0.2)',
  },
  // Midday
  11: {
    mode: 'inSky', size: 28,
    gradient: 'radial-gradient(circle,#fffde8 0%,#fcd048 50%,#f0a020 100%)',
    shadow: '0 0 18px 6px rgba(250,205,70,0.18)',
  },
  // Golden hour
  16: {
    mode: 'clipped', size: 60,
    gradient: 'radial-gradient(circle,#fffee8 0%,#fee860 20%,#f8ac28 40%,#ee7808 55%,rgba(230,110,10,0.18) 72%,transparent 100%)',
    shadow: '',
  },
  // Dusk
  19: {
    mode: 'clipped', size: 40,
    gradient: 'radial-gradient(circle,#fff4d0 0%,#f8c060 24%,#f09020 44%,#cc6010 58%,rgba(190,80,15,0.16) 74%,transparent 100%)',
    shadow: '',
  },
};

/** Get celestial keyframe for a given boundary hour */
function getCelestialKeyframe(hour: number): CelestialKeyframe {
  return CELESTIAL_KEYFRAMES[hour] ?? { mode: 'hidden', size: 0, gradient: '', shadow: '' };
}

/** Lerp between two numbers */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── COMPUTE BLENDED SCENE + CELESTIAL ────────────────────

function computeSceneState(fh: number) {
  const { from, to, t, fromHour, toHour } = getScenePair(fh);
  const scene = blendScenes(from, to, t);

  // Celestial interpolation
  const fromCel = getCelestialKeyframe(fromHour);
  const toCel = getCelestialKeyframe(toHour);

  // Determine blended celestial size
  const celSize = lerp(fromCel.size, toCel.size, t);

  // Determine mode — snap at midpoint
  const celMode = t < 0.5 ? fromCel.mode : toCel.mode;

  // Use the gradient from whichever mode is active
  const celGradient = t < 0.5 ? fromCel.gradient : toCel.gradient;
  const celShadow = t < 0.5 ? fromCel.shadow : toCel.shadow;

  // Blended sun.top for in-sky positioning
  const sunTop = scene.sun.top;
  const sunOpacity = scene.sun.opacity;

  return {
    scene,
    celMode,
    celSize,
    celGradient,
    celShadow,
    sunTop,
    sunOpacity,
  };
}

// ── COMPONENT ────────────────────────────────────────────

interface SceneBackgroundProps {
  onCelestialPosition?: (pos: CelestialPosition) => void;
}

export default function SceneBackground({ onCelestialPosition }: SceneBackgroundProps) {
  // ── Initialize solar time system on mount ──────────────
  // Non-blocking: requests geolocation, computes solar anchors,
  // then triggers a re-render so scene boundaries update.
  // Falls back to fixed-hour boundaries if location unavailable.
  const [, setSolarReady] = useState(false);

  useEffect(() => {
    if (!isSolarInitialized()) {
      initSolarTime().then(() => {
        setSolarReady(true);     // trigger re-render with solar boundaries
        setFh(getFractionalHour()); // recompute scene with new boundaries
      });
    }
  }, []);

  // ── Real-time state: update every 30 seconds ──────────
  const [fh, setFh] = useState(getFractionalHour);

  useEffect(() => {
    const id = setInterval(() => {
      setFh(getFractionalHour());
    }, 30_000); // 30-second interval for smooth celestial motion
    return () => clearInterval(id);
  }, []);

  // ── Compute blended scene ─────────────────────────────
  const {
    scene: sc,
    celMode,
    celSize,
    celGradient,
    celShadow,
    sunTop,
    sunOpacity,
  } = computeSceneState(fh);

  const skyGradient   = `linear-gradient(to bottom, ${sc.sky.join(',')})`;
  const waterGradient = `linear-gradient(to bottom, ${sc.water.join(',')})`;

  // ── Celestial rendering booleans ──────────────────────
  const isMoon    = celMode === 'moon';
  const isClipped = celMode === 'clipped' && sunOpacity > 0;
  const isInSky   = celMode === 'inSky' && sunOpacity > 0;
  const clipHalf  = Math.round(celSize / 2);
  const clipSunSize = Math.round(celSize);
  const skySunSize  = Math.round(celSize);

  const MOON_SIZE = 26;

  // ── Report celestial position ─────────────────────────
  const lastReportedRef = useRef<string>('');

  useEffect(() => {
    if (!onCelestialPosition) return;

    let pos: CelestialPosition;

    if (isMoon) {
      pos = {
        x: `calc(68% + ${MOON_SIZE / 2}px)`,
        y: `calc(12% + ${MOON_SIZE / 2}px)`,
        isMoon: true,
        size: MOON_SIZE,
      };
    } else if (isClipped && clipSunSize > 0) {
      pos = {
        x: '50%',
        y: `${SCENE_HORIZON_PERCENT}%`,
        isMoon: false,
        size: clipSunSize,
      };
    } else if (isInSky && skySunSize > 0) {
      pos = {
        x: `calc(50% + ${skySunSize / 2}px)`,
        y: `calc(${sunTop}% + ${skySunSize / 2}px)`,
        isMoon: false,
        size: skySunSize,
      };
    } else {
      pos = {
        x: '50%',
        y: `${SCENE_HORIZON_PERCENT}%`,
        isMoon: false,
        size: 0,
      };
    }

    const key = `${pos.x}|${pos.y}|${pos.isMoon}|${pos.size}`;
    if (key !== lastReportedRef.current) {
      lastReportedRef.current = key;
      onCelestialPosition(pos);
    }
  }, [isMoon, isClipped, isInSky, clipSunSize, skySunSize, sunTop, onCelestialPosition]);

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
      {isMoon && (
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
            background: celGradient,
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
            top: `${sunTop}%`,
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
            background: celGradient || 'radial-gradient(circle,#fffde8 0%,#fcd048 50%,#f0a020 100%)',
            boxShadow: celShadow,
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
