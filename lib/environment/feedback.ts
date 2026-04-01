// ── SESSION 16B: SUBTLE FEEDBACK LOOP ───────────────────────
// When user does something meaningful:
// → environment acknowledges it
// → but does NOT celebrate loudly
//
// Goal: subconscious reinforcement
// Not: explicit reward
//
// This module coordinates the "moment of acknowledgment" —
// a brief, barely-perceptible shift that registers emotionally
// without demanding attention.

import { onReflection, type ReflectionEvent } from '@/lib/chat/reflection';
import { recordActivity, evaluateEnvironmentState } from './state';
import { getElementResponse, type ElementResponse } from './bird-behavior';

// ── FEEDBACK EVENT ────────────────────────────────────────

export interface EnvironmentFeedback {
  /** What triggered this feedback */
  trigger: ReflectionEvent;
  /** Element response (acknowledge/celebrate/settle) */
  elementResponse: ElementResponse;
  /** Current environment state snapshot at feedback time */
  energyScore: number;
  /** Timestamp */
  timestamp: number;
}

// ── FEEDBACK LISTENERS ──────────────────────────────────────

type FeedbackCallback = (feedback: EnvironmentFeedback) => void;
const _feedbackListeners: Set<FeedbackCallback> = new Set();

/**
 * Subscribe to environment feedback events.
 * These fire when the environment should subtly shift
 * in response to user action.
 * Returns unsubscribe function.
 */
export function onEnvironmentFeedback(callback: FeedbackCallback): () => void {
  _feedbackListeners.add(callback);
  return () => { _feedbackListeners.delete(callback); };
}

function emitFeedback(feedback: EnvironmentFeedback): void {
  _feedbackListeners.forEach(cb => {
    try { cb(feedback); } catch (err) {
      console.error('Environment feedback listener error:', err);
    }
  });
}

// ── FEEDBACK ENGINE ─────────────────────────────────────────
// Auto-subscribes to reflection events.
// Records activity. Evaluates state. Emits feedback.

let _feedbackInitialized = false;
let _unsubscribers: (() => void)[] = [];

/**
 * Initialize the environment feedback loop.
 * Listens to reflection events and produces feedback.
 * Idempotent — safe to call multiple times.
 */
export function initEnvironmentFeedback(): () => void {
  if (_feedbackInitialized) {
    return () => {
      _unsubscribers.forEach(u => u());
      _feedbackInitialized = false;
    };
  }

  _feedbackInitialized = true;

  // Events that represent meaningful user actions
  const actionEvents: ReflectionEvent[] = [
    'task:completed',
    'task:created',
    'task:updated',
    'event:created',
    'interaction:created',
    'item:created',
    'person:created',
    'blocker:detected',
  ];

  _unsubscribers = actionEvents.map(event =>
    onReflection(event, () => {
      // Record activity for state tracking
      recordActivity();

      // Get element response
      const elementResponse = getElementResponse(event);

      // Skip noise events
      if (elementResponse.type === 'none') return;

      // Evaluate current state
      const state = evaluateEnvironmentState();

      // Emit feedback
      emitFeedback({
        trigger: event,
        elementResponse,
        energyScore: state.energyScore,
        timestamp: Date.now(),
      });
    }),
  );

  return () => {
    _unsubscribers.forEach(u => u());
    _unsubscribers = [];
    _feedbackInitialized = false;
  };
}
