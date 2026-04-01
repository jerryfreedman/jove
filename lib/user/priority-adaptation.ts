// ── SESSION 16C: BOUNDED PRIORITY ADAPTATION ────────────────
// Allows slight prioritization influence from user behavior.
//
// STRICT LIMITS:
//   - Max 10–15% influence on ordering
//   - Core prioritization logic remains dominant
//   - Adaptation may reorder within same priority tier
//   - Adaptation MUST NOT hide tasks
//   - Adaptation MUST NOT suppress urgent items
//   - Adaptation MUST NOT create conflicting priorities
//   - Adaptation MUST NOT override system decisions
//
// TRUTH OVERRIDE RULE (CRITICAL):
//   Adaptation NEVER overrides:
//   - Urgent tasks
//   - due_at deadlines
//   - Explicit commitments
//   - Blocker-related actions
//   If conflict exists: task reality ALWAYS wins.
//
// SINGLE SOURCE OF TRUTH:
//   All adaptation operates on the same task/query data used by:
//   - Control panel
//   - Sun evaluation
//   No alternate state. No cached assumptions. No independent priority layers.

import type { SystemTask } from '@/lib/task-types';
import { getEngagementRatio, getBehaviorModel } from './behavior';

// ── CONSTANTS ───────────────────────────────────────────────

/**
 * Maximum priority adjustment from behavior.
 * Applied as a modifier to existing priority scores.
 * A task with priority 10 can become at most priority 8.5 or 11.5.
 */
const MAX_PRIORITY_ADJUSTMENT = 0.15; // 15% max influence

/**
 * Priority threshold below which tasks are considered urgent.
 * Urgent tasks are NEVER adjusted by behavior.
 */
const URGENT_PRIORITY_THRESHOLD = 5;

/**
 * Minimum tier gap to allow reordering.
 * Tasks within this gap of each other may swap order.
 * Tasks further apart never reorder.
 */
const TIER_GAP = 3;

// ── TRUTH GUARD ─────────────────────────────────────────────

/**
 * Determines if a task is protected from adaptation.
 * Protected tasks are NEVER reordered or deprioritized.
 */
function isProtectedTask(task: SystemTask): boolean {
  // Urgent tasks (low priority number = high urgency)
  if (task.priority <= URGENT_PRIORITY_THRESHOLD) return true;

  // Tasks with time relevance suggesting immediacy
  if (task.timeRelevance) {
    const tr = task.timeRelevance.toLowerCase();
    if (tr === 'now' || tr.startsWith('in ') && tr.includes('m')) {
      // "now" or "in Xm" — imminent
      return true;
    }
  }

  // Meeting prep tasks within 1 hour are always protected
  if (task.type === 'meeting_prep' && task.priority <= 5) return true;

  return false;
}

// ── ADAPTATION LOGIC ────────────────────────────────────────

/**
 * Compute a behavior-based priority adjustment for a task.
 * Returns a value between -MAX_ADJ and +MAX_ADJ.
 *
 * Negative = slightly boost (lower priority number = more urgent)
 * Positive = slightly deprioritize (higher priority number = less urgent)
 *
 * Returns 0 for protected tasks (truth override).
 */
function computeAdjustment(task: SystemTask): number {
  // Truth override: never adjust protected tasks
  if (isProtectedTask(task)) return 0;

  const engagement = getEngagementRatio(task.type);

  // Neutral engagement (0.5) = no adjustment
  // High engagement (>0.5) = slight boost (negative adjustment)
  // Low engagement (<0.5) = slight deprioritize (positive adjustment)
  const rawAdjustment = (0.5 - engagement) * 2; // Normalized to -1..1

  // Apply max influence cap
  const cappedAdjustment = Math.max(
    -MAX_PRIORITY_ADJUSTMENT,
    Math.min(MAX_PRIORITY_ADJUSTMENT, rawAdjustment * MAX_PRIORITY_ADJUSTMENT),
  );

  return cappedAdjustment * task.priority;
}

// ── PUBLIC API ──────────────────────────────────────────────

/**
 * Apply bounded priority adaptation to a list of system tasks.
 *
 * Rules enforced:
 *   1. Protected tasks are NEVER moved
 *   2. Adjustment is capped at 15% of original priority
 *   3. Tasks can only reorder within the same priority tier
 *   4. No tasks are ever hidden or removed
 *   5. Original task data is NOT mutated
 *
 * Returns a new array (same length, same tasks) with adjusted ordering.
 * The original priority values are preserved on each task.
 */
export function applyBehaviorAdaptation(tasks: SystemTask[]): SystemTask[] {
  const model = getBehaviorModel();

  // No adaptation if insufficient data
  if (model.totalInteractions < 20) return [...tasks];

  // Compute effective priorities (original + adjustment)
  const withEffective = tasks.map(task => ({
    task,
    originalPriority: task.priority,
    adjustment: computeAdjustment(task),
    effectivePriority: task.priority + computeAdjustment(task),
    isProtected: isProtectedTask(task),
  }));

  // Sort by effective priority, but enforce tier boundaries
  // Only allow reordering within TIER_GAP of original positions
  withEffective.sort((a, b) => {
    // If both protected, maintain original order
    if (a.isProtected && b.isProtected) {
      return a.originalPriority - b.originalPriority;
    }

    // Protected tasks always come before non-protected at same level
    if (a.isProtected && !b.isProtected && a.originalPriority <= b.originalPriority) {
      return -1;
    }
    if (!a.isProtected && b.isProtected && b.originalPriority <= a.originalPriority) {
      return 1;
    }

    // Only reorder if within tier gap of each other
    const gap = Math.abs(a.originalPriority - b.originalPriority);
    if (gap > TIER_GAP) {
      // Too far apart — maintain original order
      return a.originalPriority - b.originalPriority;
    }

    // Within tier — use effective priority
    return a.effectivePriority - b.effectivePriority;
  });

  // Return tasks in new order (original task objects unchanged)
  return withEffective.map(item => item.task);
}

/**
 * Check if a task type is trending down in engagement.
 * Returns true if user has been consistently ignoring this type.
 * Used for subtle UI hints, NEVER for hiding.
 */
export function isDownweightedType(taskType: string): boolean {
  const ratio = getEngagementRatio(taskType);
  return ratio < 0.3; // Less than 30% completion rate
}

/**
 * Check if a task type is trending up in engagement.
 * Returns true if user consistently acts on this type.
 */
export function isUpweightedType(taskType: string): boolean {
  const ratio = getEngagementRatio(taskType);
  return ratio > 0.7; // Greater than 70% completion rate
}

/**
 * Get the adaptation strength as a percentage (0-15).
 * Used for debugging and acceptance testing.
 */
export function getAdaptationStrength(): number {
  const model = getBehaviorModel();
  if (model.totalInteractions < 20) return 0;
  return Math.round(MAX_PRIORITY_ADJUSTMENT * 100);
}
