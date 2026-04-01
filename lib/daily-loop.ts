// ── SESSION 14F: DAILY LOOP ENGINE ─────────────────────────
// Provides time-of-day awareness for habit loop:
//   Morning → clarity
//   Day → capture + act
//   End → closure
//
// Passive. No notifications. No forced engagement.
// Just: context-aware defaults that make the app feel natural
// at every hour of the day.

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getFractionalHour } from './scene-interpolation';

// ── TIME-OF-DAY PHASES ────────────────────────────────────

export type DayPhase = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export function getDayPhase(fractionalHour?: number): DayPhase {
  const fh = fractionalHour ?? getFractionalHour();
  if (fh >= 5 && fh < 12)  return 'morning';
  if (fh >= 12 && fh < 14) return 'midday';
  if (fh >= 14 && fh < 18) return 'afternoon';
  if (fh >= 18 && fh < 22) return 'evening';
  return 'night';
}

// ── MORNING CUE ───────────────────────────────────────────
// "Here's what matters today" — shown once per day, first open only.
// Stored in localStorage keyed by date.

const MORNING_CUE_KEY_PREFIX = 'jove_morning_cue_';

function getMorningCueKey(): string {
  return MORNING_CUE_KEY_PREFIX + new Date().toISOString().split('T')[0];
}

export function shouldShowMorningCue(): boolean {
  if (typeof window === 'undefined') return false;
  const phase = getDayPhase();
  if (phase !== 'morning') return false;
  const key = getMorningCueKey();
  return localStorage.getItem(key) !== 'true';
}

export function markMorningCueSeen(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getMorningCueKey(), 'true');
}

// ── END-OF-DAY CLOSURE ────────────────────────────────────
// Passive signal: "You're clear for today" or "Nothing urgent left"
// Shown when:
//   - It's evening phase (6pm+)
//   - Most tasks are done OR no urgent items remain
// Shown once per day maximum.

const CLOSURE_KEY_PREFIX = 'jove_closure_';

function getClosureKey(): string {
  return CLOSURE_KEY_PREFIX + new Date().toISOString().split('T')[0];
}

export function shouldShowClosure(
  pendingTaskCount: number,
  urgentItemCount: number,
): boolean {
  if (typeof window === 'undefined') return false;
  const phase = getDayPhase();
  if (phase !== 'evening' && phase !== 'night') return false;
  // Must have low urgency
  if (urgentItemCount > 1) return false;
  if (pendingTaskCount > 3) return false;
  // Only once per day
  return localStorage.getItem(getClosureKey()) !== 'true';
}

export function markClosureSeen(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getClosureKey(), 'true');
}

export function getClosureMessage(pendingTaskCount: number): string {
  if (pendingTaskCount === 0) return "You're clear for today.";
  return 'Nothing urgent left.';
}

// ── CONTINUITY: DAY ROLLOVER ──────────────────────────────
// When a new day starts, incomplete tasks naturally carry forward.
// No reset feeling. No "you missed X" guilt.
// This is handled at the DB level (tasks stay pending),
// but we also clean up stale localStorage keys.

const STALE_KEY_PREFIXES = [
  MORNING_CUE_KEY_PREFIX,
  CLOSURE_KEY_PREFIX,
];

export function cleanupStaleKeys(): void {
  if (typeof window === 'undefined') return;
  const today = new Date().toISOString().split('T')[0];
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    for (const prefix of STALE_KEY_PREFIXES) {
      if (key.startsWith(prefix) && !key.endsWith(today)) {
        keysToRemove.push(key);
      }
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

// ── SESSION FRESHNESS ─────────────────────────────────────
// Track when user last opened the app this session.
// Used to determine if panel data should be re-fetched on return.

const SESSION_OPEN_KEY = 'jove_session_last_open';

export function markSessionOpen(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_OPEN_KEY, Date.now().toString());
}

export function getTimeSinceLastOpen(): number {
  if (typeof window === 'undefined') return Infinity;
  const stored = localStorage.getItem(SESSION_OPEN_KEY);
  if (!stored) return Infinity;
  return Date.now() - parseInt(stored, 10);
}

/** Returns true if user has been away for more than 5 minutes */
export function isReturningUser(): boolean {
  return getTimeSinceLastOpen() > 5 * 60 * 1000;
}

// ── REACT HOOK: useDailyLoop ──────────────────────────────
// Single hook for components to consume daily loop state.

export interface DailyLoopState {
  /** Current time-of-day phase */
  phase: DayPhase;
  /** Whether to show morning clarity cue (first open of day) */
  showMorningCue: boolean;
  /** Dismiss morning cue */
  dismissMorningCue: () => void;
  /** Whether end-of-day closure should show */
  showClosure: boolean;
  /** Closure message text */
  closureMessage: string;
  /** Dismiss closure signal */
  dismissClosure: () => void;
  /** Whether user is returning after being away */
  isReturning: boolean;
  /** Whether this appears to be the first open of the day */
  isFirstOpenToday: boolean;
}

export function useDailyLoop(
  pendingTaskCount: number,
  urgentItemCount: number,
): DailyLoopState {
  const [phase, setPhase] = useState<DayPhase>(() => getDayPhase());
  const [showMorningCue, setShowMorningCue] = useState(false);
  const [showClosure, setShowClosure] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const initializedRef = useRef(false);

  // Initialize on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Clean up stale day keys
    cleanupStaleKeys();

    // Check if returning user
    const returning = isReturningUser();
    setIsReturning(returning);

    // Mark this session open
    markSessionOpen();

    // Check morning cue
    if (shouldShowMorningCue()) {
      setShowMorningCue(true);
    }
  }, []);

  // Update phase periodically (every 60s)
  useEffect(() => {
    const id = setInterval(() => {
      setPhase(getDayPhase());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Re-evaluate closure when phase/task counts change
  useEffect(() => {
    if (shouldShowClosure(pendingTaskCount, urgentItemCount)) {
      setShowClosure(true);
    }
  }, [phase, pendingTaskCount, urgentItemCount]);

  // Visibility change handler — refresh on return
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const returning = isReturningUser();
        setIsReturning(returning);
        markSessionOpen();
        setPhase(getDayPhase());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const dismissMorningCue = useCallback(() => {
    setShowMorningCue(false);
    markMorningCueSeen();
  }, []);

  const dismissClosure = useCallback(() => {
    setShowClosure(false);
    markClosureSeen();
  }, []);

  const closureMessage = useMemo(
    () => getClosureMessage(pendingTaskCount),
    [pendingTaskCount],
  );

  const isFirstOpenToday = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const key = getMorningCueKey();
    // If morning cue hasn't been seen, this is first open
    return localStorage.getItem(key) !== 'true';
  }, []);

  return {
    phase,
    showMorningCue,
    dismissMorningCue,
    showClosure,
    closureMessage,
    dismissClosure,
    isReturning,
    isFirstOpenToday,
  };
}
