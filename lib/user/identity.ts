// ── SESSION 16C: IDENTITY LAYER — COORDINATION ─────────────
// Guarded identity layer with bounded personalization
// and strict truth constraints.
//
// This module coordinates all adaptation subsystems:
//   - Behavior memory (what the user does)
//   - Tone adaptation (how responses feel)
//   - Priority adaptation (subtle ordering influence)
//   - Action format (phrasing convergence)
//
// CORE PRINCIPLE:
//   Personalization shapes HOW things are shown.
//   NOT what is true.
//
// NO EXPLICIT UI:
//   User should not configure preferences.
//   Adaptation should feel invisible and natural.
//
// CONSISTENCY GUARANTEE:
//   Sun messaging aligns with task state.
//   Control panel priorities remain correct.
//   Chat recommendations match visible reality.
//   No surface may contradict another.

import type { SystemTask } from '@/lib/task-types';
import {
  initBehaviorModel,
  recordTaskCompletion,
  recordTaskIgnored,
  recordInteraction,
  recordToneSignal,
  getBehaviorModel,
  getBehaviorSummary,
  type BehaviorModel,
  type TonePreference,
} from './behavior';
import {
  getToneModifiers,
  getCurrentTone,
  adaptResponseTone,
  getTonePromptBlock,
  type ToneModifiers,
} from './tone-adaptation';
import {
  applyBehaviorAdaptation,
  isDownweightedType,
  isUpweightedType,
  getAdaptationStrength,
} from './priority-adaptation';
import {
  recordVerbUsage,
  adaptActionFormat,
  adaptActionLength,
} from './action-format';

// ── INITIALIZATION ──────────────────────────────────────────

let _initialized = false;

/**
 * Initialize the identity layer.
 * Call once at app startup. Idempotent.
 * Loads all persisted behavior data.
 */
export function initIdentityLayer(): void {
  if (_initialized) return;
  _initialized = true;
  initBehaviorModel();
}

// ── TASK PIPELINE ───────────────────────────────────────────
// The single entry point for applying identity adaptation to tasks.
// Ensures single source of truth: adapts the SAME data used everywhere.

/**
 * Apply identity-layer adaptation to system tasks.
 *
 * This is the ONLY function that should modify task ordering
 * based on user behavior. It enforces:
 *   1. Single source of truth (operates on canonical task list)
 *   2. Truth override (urgent tasks never affected)
 *   3. Bounded influence (max 15%)
 *   4. No tasks hidden
 *
 * Use this in place of raw task list wherever tasks are displayed.
 * The input tasks MUST come from deriveSystemTasks or useTaskEngine.
 */
export function adaptTasks(tasks: SystemTask[]): SystemTask[] {
  if (!_initialized) initIdentityLayer();
  return applyBehaviorAdaptation(tasks);
}

// ── ACTION PIPELINE ─────────────────────────────────────────
// Format actions to match user preferences.

/**
 * Adapt an action string to match user phrasing preferences.
 * Applies both verb preference and length adaptation.
 */
export function adaptAction(actionText: string): string {
  if (!_initialized) initIdentityLayer();
  let adapted = adaptActionFormat(actionText);
  adapted = adaptActionLength(adapted);
  return adapted;
}

// ── RESPONSE PIPELINE ───────────────────────────────────────

/**
 * Adapt a response string based on tone preferences.
 */
export function adaptResponse(response: string): string {
  if (!_initialized) initIdentityLayer();
  return adaptResponseTone(response);
}

/**
 * Get tone-aware LLM prompt block.
 * Inject into system prompt for chat responses.
 */
export function getIdentityPromptBlock(): string {
  if (!_initialized) initIdentityLayer();

  const toneBlock = getTonePromptBlock();
  const summaries = getBehaviorSummary();

  const parts: string[] = [];

  if (toneBlock) {
    parts.push(toneBlock);
  }

  if (summaries.length > 0) {
    parts.push(`User behavior notes: ${summaries.join('; ')}.`);
  }

  return parts.join('\n');
}

// ── EVENT RECORDING ─────────────────────────────────────────
// Convenience wrappers that route events to the right subsystem.

export { recordTaskCompletion } from './behavior';
export { recordTaskIgnored } from './behavior';
export { recordInteraction } from './behavior';
export { recordToneSignal } from './behavior';
export { recordVerbUsage } from './action-format';

// ── READ ACCESS ─────────────────────────────────────────────

export {
  getBehaviorModel,
  getBehaviorSummary,
  getCurrentTone,
  getToneModifiers,
  isDownweightedType,
  isUpweightedType,
  getAdaptationStrength,
};

// Re-export types
export type { BehaviorModel, TonePreference, ToneModifiers };
