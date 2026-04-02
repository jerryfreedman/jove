// ── SESSION 15: TASK SYSTEM HELPERS ─────────────────────────
// Central exports for task creation, normalization, and scheduling.

export { shouldCreateTask, shouldCreateDerivedTask } from './shouldCreateTask';
export type { TaskCreationDecision } from './shouldCreateTask';

export { normalizeTaskTitle } from './normalizeTaskTitle';
export type { NormalizedTitle } from './normalizeTaskTitle';

export { getTaskSchedulingState, getUnscheduledTasks } from './taskSchedulingState';
export type { TaskSchedulingState, TaskSchedulingInfo } from './taskSchedulingState';
