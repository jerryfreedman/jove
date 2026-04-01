// ── SESSION 16A: REAL MOMENTUM SYSTEM ───────────────────────
// Reflects real progress. Not gamification.
//
// Only increases on meaningful forward movement:
//   - Task completed
//   - Blocker resolved
//   - Decision made / next step confirmed
//   - Time-bound action executed
//
// Does NOT increase on:
//   - Raw note capture
//   - Duplicate entry
//   - Vague input
//   - Passive interaction
//
// Provides:
//   1. Signal classification (high / medium / low)
//   2. Daily momentum state (stalled → clear)
//   3. Reinforcement messages (subtle, rare)
//   4. Sun tone adaptation
//   5. Noise control (max 1-2 messages per session)

import { onReflection, emitReflection, type ReflectionEvent } from '@/lib/chat/reflection';

// ── SIGNAL CLASSIFICATION ────────────────────────────────────

export type MomentumSignalLevel = 'high' | 'medium' | 'low' | 'none';

export interface MomentumSignal {
  level: MomentumSignalLevel;
  source: ReflectionEvent;
  /** Points contributed to daily score */
  weight: number;
  timestamp: number;
}

/**
 * Map a reflection event to its momentum signal level and weight.
 * Only HIGH and select MEDIUM signals contribute meaningfully.
 */
export function classifySignal(event: ReflectionEvent): { level: MomentumSignalLevel; weight: number } {
  switch (event) {
    // HIGH SIGNAL — real forward movement
    case 'task:completed':
      return { level: 'high', weight: 20 };
    case 'blocker:detected':
      // Blocker *resolved* is high — detection alone is medium.
      // We classify detection as medium; resolution comes via task:completed.
      return { level: 'medium', weight: 8 };

    // MEDIUM SIGNAL — clear intent or prep
    case 'task:created':
      return { level: 'medium', weight: 5 };
    case 'task:updated':
      return { level: 'medium', weight: 8 };
    case 'event:created':
      return { level: 'medium', weight: 5 };

    // LOW / NO SIGNAL — passive
    case 'interaction:created':
      return { level: 'low', weight: 2 };
    case 'item:created':
      return { level: 'low', weight: 2 };
    case 'person:created':
      return { level: 'low', weight: 1 };
    case 'data:changed':
      return { level: 'none', weight: 0 };

    default:
      return { level: 'none', weight: 0 };
  }
}

// ── DAILY MOMENTUM STATE ─────────────────────────────────────

export type MomentumState = 'stalled' | 'in_progress' | 'moving' | 'clear';

export interface DailyMomentum {
  /** Score 0–100 */
  score: number;
  /** Derived state from score */
  state: MomentumState;
  /** Signals recorded today */
  signals: MomentumSignal[];
  /** Date key (YYYY-MM-DD) */
  dateKey: string;
}

function scoreToState(score: number): MomentumState {
  if (score >= 70) return 'clear';
  if (score >= 40) return 'moving';
  if (score >= 10) return 'in_progress';
  return 'stalled';
}

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

// ── IN-MEMORY DAILY STORE ────────────────────────────────────
// Lightweight. Resets on page reload (intentional — no fake persistence).
// localStorage used only for cross-tab consistency within same day.

const STORAGE_KEY = 'jove_momentum_daily';

interface StoredMomentum {
  dateKey: string;
  score: number;
  signalCount: number;
  highSignalCount: number;
}

function loadStored(): StoredMomentum | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredMomentum;
    // Only valid if same day
    if (parsed.dateKey !== todayKey()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStored(data: StoredMomentum): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Silent — non-critical
  }
}

// ── MOMENTUM ENGINE (SINGLETON) ──────────────────────────────

let _daily: DailyMomentum = {
  score: 0,
  state: 'stalled',
  signals: [],
  dateKey: todayKey(),
};

let _initialized = false;

/**
 * Initialize momentum engine. Idempotent.
 * Restores from localStorage if same day, otherwise starts fresh.
 */
export function initMomentum(): void {
  if (_initialized) return;
  _initialized = true;

  const stored = loadStored();
  if (stored) {
    _daily = {
      score: Math.min(stored.score, 100),
      state: scoreToState(stored.score),
      signals: [], // Don't persist full signal history
      dateKey: stored.dateKey,
    };
  } else {
    _daily = {
      score: 0,
      state: 'stalled',
      signals: [],
      dateKey: todayKey(),
    };
  }
}

/**
 * Record a momentum signal from a reflection event.
 * Returns the updated daily state, or null if the signal was noise.
 */
export function recordSignal(event: ReflectionEvent): DailyMomentum | null {
  // Ensure initialized
  if (!_initialized) initMomentum();

  // Day rollover check
  const today = todayKey();
  if (_daily.dateKey !== today) {
    _daily = { score: 0, state: 'stalled', signals: [], dateKey: today };
  }

  const { level, weight } = classifySignal(event);

  // Skip noise
  if (level === 'none' || weight === 0) return null;

  const signal: MomentumSignal = {
    level,
    source: event,
    weight,
    timestamp: Date.now(),
  };

  _daily.signals.push(signal);
  _daily.score = Math.min(_daily.score + weight, 100);
  _daily.state = scoreToState(_daily.score);

  // Persist
  const stored = loadStored();
  saveStored({
    dateKey: today,
    score: _daily.score,
    signalCount: (stored?.signalCount ?? 0) + 1,
    highSignalCount: (stored?.highSignalCount ?? 0) + (level === 'high' ? 1 : 0),
  });

  // Notify Sun and other subscribers that momentum changed
  emitReflection('momentum:changed');

  return { ..._daily };
}

/**
 * Get current daily momentum state (read-only snapshot).
 */
export function getMomentum(): DailyMomentum {
  if (!_initialized) initMomentum();

  // Day rollover check
  const today = todayKey();
  if (_daily.dateKey !== today) {
    _daily = { score: 0, state: 'stalled', signals: [], dateKey: today };
  }

  return { ..._daily };
}

/**
 * Get count of high signals today (task completions, etc.)
 */
export function getHighSignalCount(): number {
  const stored = loadStored();
  return stored?.highSignalCount ?? 0;
}

// ── REINFORCEMENT MESSAGES ───────────────────────────────────
// Subtle. Earned. Never spammy.
// Max 1-2 per session. Only on HIGH signal events.

export type ReinforcementMessage = {
  text: string;
  /** Whether this should actually display (noise control) */
  shouldShow: boolean;
};

const TASK_COMPLETED_MESSAGES = [
  'Nice — that\'s handled.',
  'Done. One less thing.',
  'Good — that\'s off your plate.',
  'Handled.',
];

const BLOCKER_RESOLVED_MESSAGES = [
  'Good — that moved forward.',
  'Unblocked.',
  'That clears the path.',
];

const DECISION_MESSAGES = [
  'That clarifies things.',
  'Good call.',
  'Clear direction.',
];

// Session-level noise control
let _sessionMessageCount = 0;
const MAX_SESSION_MESSAGES = 2;
let _lastMessageTime = 0;
const MIN_MESSAGE_GAP_MS = 60_000; // 1 minute minimum between messages

/**
 * Get a reinforcement message for a momentum event.
 * Returns null if noise control suppresses it.
 */
export function getReinforcementMessage(event: ReflectionEvent): ReinforcementMessage | null {
  const { level } = classifySignal(event);

  // Only reinforce HIGH signals
  if (level !== 'high') return null;

  // Noise control: max per session
  if (_sessionMessageCount >= MAX_SESSION_MESSAGES) {
    return null;
  }

  // Noise control: minimum gap
  const now = Date.now();
  if (now - _lastMessageTime < MIN_MESSAGE_GAP_MS) {
    return null;
  }

  // Pick message based on event type
  let pool: string[];
  switch (event) {
    case 'task:completed':
      pool = TASK_COMPLETED_MESSAGES;
      break;
    default:
      pool = DECISION_MESSAGES;
      break;
  }

  // Simple rotation based on high signal count
  const idx = getHighSignalCount() % pool.length;
  const text = pool[idx];

  _sessionMessageCount++;
  _lastMessageTime = now;

  return { text, shouldShow: true };
}

// ── SUN TONE ADAPTATION ──────────────────────────────────────
// Returns a momentum-aware headline modifier for Sun state.
// Sun should reflect state, not data.

export interface MomentumTone {
  /** Optional headline override based on momentum */
  headline: string | null;
  /** Whether sun should feel settled */
  isSettled: boolean;
}

/**
 * Get Sun tone based on current momentum state.
 * Returns null headline if momentum shouldn't influence Sun right now.
 */
export function getMomentumTone(): MomentumTone {
  const { state, score } = getMomentum();

  switch (state) {
    case 'stalled':
      return {
        headline: score === 0 ? null : 'Let\'s get one thing moving.',
        isSettled: false,
      };
    case 'in_progress':
      return {
        headline: 'You\'ve started — keep pushing.',
        isSettled: false,
      };
    case 'moving':
      return {
        headline: 'Things are progressing.',
        isSettled: false,
      };
    case 'clear':
      return {
        headline: 'You\'re in a good spot.',
        isSettled: true,
      };
  }
}

// ── CONTROL PANEL INTEGRATION ────────────────────────────────
// Returns a subtle, emotional status line for the control panel.
// Not analytical. Not numbers. Just: how things feel.

export function getMomentumStatusLine(): string | null {
  const { state, score } = getMomentum();

  // Phase 8: Failure safety — if uncertain, show nothing
  if (!_initialized) return null;

  switch (state) {
    case 'clear':
      return 'You moved things forward today.';
    case 'moving':
      return 'Things are moving.';
    case 'in_progress':
      return 'A few things are still open.';
    case 'stalled':
      // Only show if there's been *some* activity (score > 0)
      // If truly zero activity, show nothing (failure safety)
      return score > 0 ? 'A few things are still open.' : null;
  }
}

// ── REFLECTION LISTENER ──────────────────────────────────────
// Auto-subscribe to reflection events and update momentum.
// Returns unsubscribe function.

export type MomentumChangeCallback = (
  daily: DailyMomentum,
  reinforcement: ReinforcementMessage | null,
) => void;

/**
 * Subscribe to momentum changes driven by reflection events.
 * Callback fires only when momentum actually changes (not on noise).
 */
export function onMomentumChange(callback: MomentumChangeCallback): () => void {
  const events: ReflectionEvent[] = [
    'task:completed',
    'task:created',
    'task:updated',
    'event:created',
    'blocker:detected',
  ];

  const unsubs = events.map(event =>
    onReflection(event, () => {
      const updated = recordSignal(event);
      if (updated) {
        const reinforcement = getReinforcementMessage(event);
        callback(updated, reinforcement);
      }
    }),
  );

  return () => unsubs.forEach(u => u());
}
