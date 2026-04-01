'use client';

import { useState, useEffect, useReducer, useCallback } from 'react';
import { TIMING, EASING, TRANSITIONS } from '@/lib/design-system';

// ── TYPES ────────────────────────────────────────────────
export type TourStop = {
  ref: React.RefObject<HTMLElement>;
  copy: string;
  position?: 'above' | 'below' | 'auto';
};

export type SpotlightTourProps = {
  stops: TourStop[];
  storageKey: string;
  onComplete: () => void;
  delayMs?: number;
};

// ── COMPONENT ────────────────────────────────────────────
export default function SpotlightTour({
  stops,
  storageKey,
  onComplete,
  delayMs = 0,
}: SpotlightTourProps) {
  const [currentStopIndex, setCurrentStopIndex] = useState(-1);
  const [ready, setReady] = useState(false);

  // Force re-render on resize to recalc rects
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    window.addEventListener('resize', forceUpdate);
    return () => window.removeEventListener('resize', forceUpdate);
  }, []);

  // Delay before showing first stop
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true);
      setCurrentStopIndex(0);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  // Skip stops where ref.current is null
  const advanceToNextValid = useCallback(
    (fromIndex: number) => {
      let next = fromIndex;
      while (next < stops.length && !stops[next].ref.current) {
        next++;
      }
      if (next >= stops.length) {
        // All remaining stops are null — complete
        localStorage.setItem(storageKey, 'true');
        onComplete();
        return;
      }
      setCurrentStopIndex(next);
    },
    [stops, storageKey, onComplete],
  );

  // On index change, validate current ref
  useEffect(() => {
    if (!ready || currentStopIndex < 0) return;
    if (currentStopIndex >= stops.length) {
      localStorage.setItem(storageKey, 'true');
      onComplete();
      return;
    }
    if (!stops[currentStopIndex].ref.current) {
      advanceToNextValid(currentStopIndex + 1);
    }
  }, [currentStopIndex, ready, stops, storageKey, onComplete, advanceToNextValid]);

  // ── Don't render if already completed ──
  if (typeof window !== 'undefined' && localStorage.getItem(storageKey) === 'true') {
    return null;
  }

  if (!ready || currentStopIndex < 0 || currentStopIndex >= stops.length) {
    return null;
  }

  const currentStop = stops[currentStopIndex];
  const currentRef = currentStop.ref.current;
  if (!currentRef) return null;

  // ── Spotlight calculations ──
  const rect = currentRef.getBoundingClientRect();
  const padding = 16;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r = Math.max(rect.width, rect.height) / 2 + padding;

  // ── Tooltip positioning ──
  const tooltipWidth = Math.min(280, window.innerWidth - 48);
  const tooltipLeft = (window.innerWidth - tooltipWidth) / 2;

  const targetCenterY = rect.top + rect.height / 2;
  const isInTopPortion = targetCenterY < window.innerHeight * 0.6;

  let explicitPosition = currentStop.position;
  if (!explicitPosition || explicitPosition === 'auto') {
    explicitPosition = isInTopPortion ? 'below' : 'above';
  }

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 107,
    width: tooltipWidth,
    left: tooltipLeft,
    background: '#1A1E28',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: '16px 20px',
    animation: 'fadeUp 0.3s ease both',
  };

  if (explicitPosition === 'below') {
    tooltipStyle.top = rect.bottom + 24;
  } else {
    tooltipStyle.bottom = window.innerHeight - rect.top + 24;
  }

  const isLastStop = currentStopIndex === stops.length - 1;

  const handleGotIt = () => {
    if (isLastStop) {
      localStorage.setItem(storageKey, 'true');
      onComplete();
    } else {
      advanceToNextValid(currentStopIndex + 1);
    }
  };

  const handleSkip = () => {
    localStorage.setItem(storageKey, 'true');
    onComplete();
  };

  return (
    <>
      {/* Overlay with spotlight cutout */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 105,
          background: `radial-gradient(circle ${r}px at ${cx}px ${cy}px, transparent 0%, transparent ${r}px, rgba(0,0,0,0.78) ${r + 20}px)`,
        }}
        onClick={handleGotIt}
      />

      {/* Highlight ring */}
      <div
        style={{
          position: 'fixed',
          zIndex: 106,
          left: rect.left - padding,
          top: rect.top - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
          borderRadius: 16,
          border: '1.5px solid rgba(255,255,255,0.18)',
          pointerEvents: 'none',
        }}
      />

      {/* Tooltip card */}
      <div key={currentStopIndex} style={tooltipStyle}>
        {/* Copy text */}
        <div
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 15,
            fontWeight: 300,
            color: '#F7F3EC',
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          {currentStop.copy}
        </div>

        {/* "Got it →" button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleGotIt();
          }}
          className="jove-tap"
          style={{
            color: '#E8A030',
            fontSize: 14,
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minHeight: 44,
            padding: 0,
            fontFamily: "'DM Sans', sans-serif",
            display: 'block',
            textAlign: 'left',
          }}
        >
          Got it &rarr;
        </button>

        {/* Stop indicator dots */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 12,
          }}
        >
          {stops.map((_, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background:
                  i === currentStopIndex
                    ? '#E8A030'
                    : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>

        {/* Skip link */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSkip();
          }}
          className="jove-tap"
          style={{
            color: 'rgba(255,255,255,0.28)',
            fontSize: 12,
            fontFamily: "'DM Sans', sans-serif",
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'block',
            marginTop: 10,
            padding: 0,
          }}
        >
          Skip tour
        </button>
      </div>
    </>
  );
}
