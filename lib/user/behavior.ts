// ── SESSION 16C: USER BEHAVIOR MEMORY ───────────────────────
// Lightweight behavior model. Tracks aggregated summaries, not raw logs.
//
// Signals tracked:
//   - Task completion patterns (which types completed most)
//   - Ignored vs acted-on suggestions
//   - Preferred action style (short vs descriptive)
//   - Time-of-day engagement
//   - Interaction frequency
//
// Rules:
//   - Store aggregated summaries only
//   - No raw event logs
//   - No heavy analytics
//   - Require repeated signals before updating model
//   - Change slowly (stability rule)
//   - Ignore one-off anomalies

import { onReflection, type ReflectionEvent } from '@/lib/chat/reflection';

// ── TYPES ───────────────────────────────────────────────────

export type ActionStyle = 'direct' | 'descriptive' | 'neutral';
export type TonePreference = 'direct' | 'reflective' | 'action_oriented' | 'neutral';
export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening';

export interface TaskTypeEngagement {
  /** Number of times tasks of this type were completed */
  completed: number;
  /** Number of times tasks of this type were shown but not acted on */
  ignored: number;
}

export interface BehaviorModel {
  /** Engagement by task type */
  taskEngagement: Record<string, TaskTypeEngagement>;
  /** Preferred action phrasing style */
  actionStyle: ActionStyle;
  /** Inferred tone preference */
  tonePreference: TonePreference;
  /** Engagement counts by time of day */
  timeOfDayEngagement: Record<TimeOfDay, number>;
  /** Total interactions recorded */
  totalInteractions: number;
  /** Total task completions recorded */
  totalCompletions: number;
  /** Last updated timestamp */
  lastUpdatedAt: number;
  /** Model version — bump on schema changes */
  version: number;
}

// ── CONSTANTS ───────────────────────────────────────────────

const STORAGE_KEY = 'jove_behavior_model';
const MODEL_VERSION = 1;

/**
 * Minimum signals before model updates preferences.
 * Prevents one-off anomalies from influencing behavior.
 */
const MIN_SIGNALS_FOR_STYLE = 10;
const MIN_SIGNALS_FOR_TONE = 15;

/**
 * Decay factor: older signals gradually lose weight.
 * Applied on periodic compaction (not every signal).
 */
const DECAY_FACTOR = 0.95;
const COMPACTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

// ── DEFAULT MODEL ───────────────────────────────────────────

function createDefaultModel(): BehaviorModel {
  return {
    taskEngagement: {},
    actionStyle: 'neutral',
    tonePreference: 'neutral',
    timeOfDayEngagement: {
      morning: 0,
      midday: 0,
      afternoon: 0,
      evening: 0,
    },
    totalInteractions: 0,
    totalCompletions: 0,
    lastUpdatedAt: Date.now(),
    version: MODEL_VERSION,
  };
}

// ── PERSISTENCE ─────────────────────────────────────────────
// localStorage only — lightweight, client-side.
// This is aggregated summary data, not sensitive.

function loadModel(): BehaviorModel {
  if (typeof window === 'undefined') return createDefaultModel();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultModel();
    const parsed = JSON.parse(raw) as BehaviorModel;
    if (parsed.version !== MODEL_VERSION) return createDefaultModel();
    return parsed;
  } catch {
    return createDefaultModel();
  }
}

function saveModel(model: BehaviorModel): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Silent — non-critical
  }
}

// ── SINGLETON STATE ─────────────────────────────────────────

let _model: BehaviorModel = createDefaultModel();
let _initialized = false;
let _lastCompaction = 0;

// ── TIME HELPERS ────────────────────────────────────────────

function getCurrentTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  return 'evening';
}

// ── INITIALIZATION ──────────────────────────────────────────

export function initBehaviorModel(): void {
  if (_initialized) return;
  _initialized = true;
  _model = loadModel();
  _lastCompaction = _model.lastUpdatedAt;
}

// ── SIGNAL RECORDING ────────────────────────────────────────

/**
 * Record a task completion event.
 * Updates engagement counts and infers style preferences.
 */
export function recordTaskCompletion(taskType: string, actionText?: string): void {
  if (!_initialized) initBehaviorModel();

  // Update task type engagement
  if (!_model.taskEngagement[taskType]) {
    _model.taskEngagement[taskType] = { completed: 0, ignored: 0 };
  }
  _model.taskEngagement[taskType].completed++;
  _model.totalCompletions++;

  // Update time-of-day engagement
  const tod = getCurrentTimeOfDay();
  _model.timeOfDayEngagement[tod]++;

  // Track action style from completion text length
  if (actionText) {
    updateActionStyleSignal(actionText);
  }

  // Update total interactions
  _model.totalInteractions++;
  _model.lastUpdatedAt = Date.now();

  maybeCompact();
  saveModel(_model);
}

/**
 * Record that a task was shown but not acted on.
 * Only call this after sufficient exposure time (not immediately).
 */
export function recordTaskIgnored(taskType: string): void {
  if (!_initialized) initBehaviorModel();

  if (!_model.taskEngagement[taskType]) {
    _model.taskEngagement[taskType] = { completed: 0, ignored: 0 };
  }
  _model.taskEngagement[taskType].ignored++;
  _model.totalInteractions++;
  _model.lastUpdatedAt = Date.now();

  maybeCompact();
  saveModel(_model);
}

/**
 * Record a general interaction (chat message, navigation, etc.)
 */
export function recordInteraction(): void {
  if (!_initialized) initBehaviorModel();

  const tod = getCurrentTimeOfDay();
  _model.timeOfDayEngagement[tod]++;
  _model.totalInteractions++;
  _model.lastUpdatedAt = Date.now();

  saveModel(_model);
}

// ── STYLE INFERENCE ─────────────────────────────────────────

/** Running counters for style inference (not persisted individually) */
let _shortActionCount = 0;
let _longActionCount = 0;

function updateActionStyleSignal(actionText: string): void {
  const wordCount = actionText.trim().split(/\s+/).length;
  if (wordCount <= 4) {
    _shortActionCount++;
  } else if (wordCount >= 7) {
    _longActionCount++;
  }

  // Only update preference after enough signals
  const totalStyleSignals = _shortActionCount + _longActionCount;
  if (totalStyleSignals < MIN_SIGNALS_FOR_STYLE) return;

  const shortRatio = _shortActionCount / totalStyleSignals;
  if (shortRatio > 0.65) {
    _model.actionStyle = 'direct';
  } else if (shortRatio < 0.35) {
    _model.actionStyle = 'descriptive';
  } else {
    _model.actionStyle = 'neutral';
  }
}

// ── TONE INFERENCE ──────────────────────────────────────────

/**
 * Record a tone signal from user behavior.
 * Called by chat layer when user message patterns emerge.
 */
export function recordToneSignal(signal: 'short_message' | 'asks_context' | 'asks_next_step'): void {
  if (!_initialized) initBehaviorModel();

  // Only infer after enough signals
  if (_model.totalInteractions < MIN_SIGNALS_FOR_TONE) return;

  // Gradual convergence — don't flip on single signal
  switch (signal) {
    case 'short_message':
      if (_model.tonePreference === 'neutral') {
        _model.tonePreference = 'direct';
      }
      break;
    case 'asks_context':
      if (_model.tonePreference === 'neutral') {
        _model.tonePreference = 'reflective';
      }
      break;
    case 'asks_next_step':
      if (_model.tonePreference === 'neutral') {
        _model.tonePreference = 'action_oriented';
      }
      break;
  }

  _model.lastUpdatedAt = Date.now();
  saveModel(_model);
}

// ── COMPACTION ──────────────────────────────────────────────
// Applies decay to prevent stale patterns from dominating.
// Runs at most once per day.

function maybeCompact(): void {
  const now = Date.now();
  if (now - _lastCompaction < COMPACTION_INTERVAL_MS) return;
  _lastCompaction = now;

  // Apply decay to all engagement counts
  for (const key of Object.keys(_model.taskEngagement)) {
    const engagement = _model.taskEngagement[key];
    engagement.completed = Math.round(engagement.completed * DECAY_FACTOR);
    engagement.ignored = Math.round(engagement.ignored * DECAY_FACTOR);

    // Remove stale entries with no meaningful data
    if (engagement.completed === 0 && engagement.ignored === 0) {
      delete _model.taskEngagement[key];
    }
  }

  // Apply decay to time-of-day engagement
  for (const key of Object.keys(_model.timeOfDayEngagement) as TimeOfDay[]) {
    _model.timeOfDayEngagement[key] = Math.round(
      _model.timeOfDayEngagement[key] * DECAY_FACTOR
    );
  }
}

// ── READ ACCESS ─────────────────────────────────────────────

/**
 * Get current behavior model (read-only snapshot).
 */
export function getBehaviorModel(): Readonly<BehaviorModel> {
  if (!_initialized) initBehaviorModel();
  return { ..._model };
}

/**
 * Get engagement ratio for a task type.
 * Returns value between 0 (always ignored) and 1 (always completed).
 * Returns 0.5 (neutral) if insufficient data.
 */
export function getEngagementRatio(taskType: string): number {
  if (!_initialized) initBehaviorModel();

  const engagement = _model.taskEngagement[taskType];
  if (!engagement) return 0.5;

  const total = engagement.completed + engagement.ignored;
  if (total < 3) return 0.5; // Insufficient data

  return engagement.completed / total;
}

/**
 * Get the user's most active time of day.
 * Returns null if insufficient data.
 */
export function getPeakTimeOfDay(): TimeOfDay | null {
  if (!_initialized) initBehaviorModel();

  const entries = Object.entries(_model.timeOfDayEngagement) as [TimeOfDay, number][];
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (total < 10) return null; // Insufficient data

  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

/**
 * Get a summary of behavior patterns (for debugging/logging only).
 * These are the aggregated summaries described in the spec.
 */
export function getBehaviorSummary(): string[] {
  if (!_initialized) initBehaviorModel();

  const summaries: string[] = [];

  // Action style
  if (_model.actionStyle !== 'neutral') {
    summaries.push(
      _model.actionStyle === 'direct'
        ? 'prefers short direct actions'
        : 'prefers descriptive actions'
    );
  }

  // Tone preference
  if (_model.tonePreference !== 'neutral') {
    summaries.push(`responds to ${_model.tonePreference} tone`);
  }

  // Peak time
  const peak = getPeakTimeOfDay();
  if (peak) {
    summaries.push(`most active in ${peak}`);
  }

  // Engagement patterns
  for (const [taskType, engagement] of Object.entries(_model.taskEngagement)) {
    const total = engagement.completed + engagement.ignored;
    if (total < 5) continue;
    const ratio = engagement.completed / total;
    if (ratio > 0.7) {
      summaries.push(`acts quickly on ${taskType} tasks`);
    } else if (ratio < 0.3) {
      summaries.push(`often skips ${taskType} tasks`);
    }
  }

  return summaries;
}

// ── REFLECTION LISTENER ─────────────────────────────────────
// Auto-subscribe to relevant reflection events.

export function onBehaviorRelevantEvent(callback: () => void): () => void {
  const events: ReflectionEvent[] = [
    'task:completed',
    'task:created',
    'interaction:created',
  ];

  const unsubs = events.map(event =>
    onReflection(event, callback),
  );

  return () => unsubs.forEach(u => u());
}
