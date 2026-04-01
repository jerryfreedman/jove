// ── SESSION 16B: BIRD / ELEMENT BEHAVIOR ────────────────────
// Tie ambient elements to user actions.
// Bird and fish respond to what happens — not randomly.
//
// RULES:
// - Small visual response to captures
// - Slight environment shift on task completion
// - Environment settles when idle
// - NEVER trigger large animations
// - NEVER interrupt user flow

import { onReflection, type ReflectionEvent } from '@/lib/chat/reflection';

// ── ELEMENT RESPONSE TYPES ─────────────────────────────────

export type ElementResponseType =
  | 'acknowledge'    // Small, brief — "I noticed that"
  | 'celebrate'      // Slightly more — task completed, milestone
  | 'settle'         // Environment calms down
  | 'none';          // No response needed

export interface ElementResponse {
  type: ElementResponseType;
  /** Intensity 0–1. Even 'celebrate' should max at ~0.6 */
  intensity: number;
  /** Duration in ms. Short. Always. */
  durationMs: number;
}

// ── RESPONSE MAPPING ──────────────────────────────────────

/**
 * Map a reflection event to the appropriate element response.
 * Most events → acknowledge (tiny). Task completion → celebrate (small).
 * Data changes → none (noise).
 */
export function getElementResponse(event: ReflectionEvent): ElementResponse {
  switch (event) {
    // Meaningful forward movement
    case 'task:completed':
      return { type: 'celebrate', intensity: 0.5, durationMs: 1200 };

    // Active engagement — small acknowledgment
    case 'task:created':
      return { type: 'acknowledge', intensity: 0.3, durationMs: 600 };
    case 'task:updated':
      return { type: 'acknowledge', intensity: 0.25, durationMs: 500 };
    case 'event:created':
      return { type: 'acknowledge', intensity: 0.3, durationMs: 600 };

    // Capture — bird should respond (it's "their" action)
    case 'interaction:created':
    case 'item:created':
      return { type: 'acknowledge', intensity: 0.35, durationMs: 700 };
    case 'person:created':
      return { type: 'acknowledge', intensity: 0.2, durationMs: 400 };

    // Blocker detected — subtle tension
    case 'blocker:detected':
      return { type: 'acknowledge', intensity: 0.15, durationMs: 400 };

    // System events — no visual response
    case 'momentum:changed':
    case 'data:changed':
      return { type: 'none', intensity: 0, durationMs: 0 };

    default:
      return { type: 'none', intensity: 0, durationMs: 0 };
  }
}

// ── BIRD-SPECIFIC BEHAVIOR PARAMS ─────────────────────────
// Translates ElementResponse into bird-compatible values.

export interface BirdBehaviorParams {
  /** Speed multiplier (1.0 = normal). Brief burst on acknowledge. */
  speedMultiplier: number;
  /** Whether to trigger a wing flap burst */
  triggerFlap: boolean;
  /** Whether to trigger a small soar arc */
  triggerSoar: boolean;
  /** Sine amplitude modifier (0.8–1.2). Settles = lower. */
  amplitudeModifier: number;
}

export function getBirdBehavior(response: ElementResponse): BirdBehaviorParams {
  switch (response.type) {
    case 'celebrate':
      return {
        speedMultiplier: 1.12,
        triggerFlap: true,
        triggerSoar: true,
        amplitudeModifier: 1.1,
      };
    case 'acknowledge':
      return {
        speedMultiplier: 1.06,
        triggerFlap: response.intensity > 0.25,
        triggerSoar: false,
        amplitudeModifier: 1.0,
      };
    case 'settle':
      return {
        speedMultiplier: 0.92,
        triggerFlap: false,
        triggerSoar: false,
        amplitudeModifier: 0.85,
      };
    case 'none':
    default:
      return {
        speedMultiplier: 1.0,
        triggerFlap: false,
        triggerSoar: false,
        amplitudeModifier: 1.0,
      };
  }
}

// ── FISH-SPECIFIC BEHAVIOR PARAMS ─────────────────────────

export interface FishBehaviorParams {
  /** Speed multiplier */
  speedMultiplier: number;
  /** Amplitude modifier for sine drift */
  amplitudeModifier: number;
}

export function getFishBehavior(response: ElementResponse): FishBehaviorParams {
  switch (response.type) {
    case 'celebrate':
      return { speedMultiplier: 1.08, amplitudeModifier: 1.1 };
    case 'acknowledge':
      return { speedMultiplier: 1.04, amplitudeModifier: 1.0 };
    case 'settle':
      return { speedMultiplier: 0.94, amplitudeModifier: 0.88 };
    case 'none':
    default:
      return { speedMultiplier: 1.0, amplitudeModifier: 1.0 };
  }
}

// ── EVENT LISTENER ───────────────────────────────────────
// Subscribe to reflection events and emit element responses.

export type ElementResponseCallback = (
  event: ReflectionEvent,
  response: ElementResponse,
  birdParams: BirdBehaviorParams,
  fishParams: FishBehaviorParams,
) => void;

/**
 * Subscribe to element behavior changes driven by reflection events.
 * Callback fires only for meaningful responses (not 'none').
 * Returns unsubscribe function.
 */
export function onElementResponse(callback: ElementResponseCallback): () => void {
  const events: ReflectionEvent[] = [
    'task:completed',
    'task:created',
    'task:updated',
    'event:created',
    'interaction:created',
    'item:created',
    'person:created',
    'blocker:detected',
  ];

  const unsubs = events.map(event =>
    onReflection(event, () => {
      const response = getElementResponse(event);
      if (response.type === 'none') return;

      const birdParams = getBirdBehavior(response);
      const fishParams = getFishBehavior(response);
      callback(event, response, birdParams, fishParams);
    }),
  );

  return () => unsubs.forEach(u => u());
}
