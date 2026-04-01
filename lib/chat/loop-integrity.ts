// ── SESSION 15C.1: LOOP INTEGRITY ────────────────────────────
// Central module that ensures:
// 1. Chat confirmations are always truthful
// 2. Control panel reflects new inputs quickly
// 3. Sun reflects new reality (no stale "you're set")
// 4. Duplicate entries are suppressed
// 5. Priorities update when new signals appear
// 6. System feels consistent and trustworthy
//
// This module re-exports all Session 15C.1 components for convenience.

// ── Re-exports ──────────────────────────────────────────────

export {
  detectSyncState,
  getOfflineAwareAcknowledgment,
  getBirdAcknowledgment,
  getFailureAcknowledgment,
  type SyncState,
} from './acknowledgment';

export {
  emitReflection,
  emitReflections,
  onReflection,
  triggerFullRefresh,
  type ReflectionEvent,
} from './reflection';

export {
  evaluateSunState,
  onSunRelevantChange,
  type SunState,
  type SunGuidanceLevel,
  type SunEvalInput,
} from './sun-state';

export {
  checkDuplicateTask,
  checkDuplicateInteraction,
  getDuplicateAcknowledgment,
  type DuplicateCheckResult,
} from './duplicate-guard';

export {
  dedupeInteractionHistory,
} from './history-dedupe';

export {
  detectPrepSignal,
  type PrepSignal,
} from './prep-signals';
