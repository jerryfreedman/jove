// ── SESSION 15: TASK SCHEDULING STATE ───────────────────────
// Determines the scheduling state of a task.
//
// States:
//   1. scheduled    — has due_at with explicit timing
//   2. unscheduled  — valid task, no time set yet
//   3. waiting      — cannot progress until something else happens
//
// Time-awareness rules:
//   - Missing time is NOT an error — it's an incomplete planning step
//   - Unscheduled tasks are eligible for follow-up prompts
//   - DO NOT require time for every task at creation

export type TaskSchedulingState = 'scheduled' | 'unscheduled' | 'waiting';

export interface TaskSchedulingInfo {
  state: TaskSchedulingState;
  /** Whether the task needs a follow-up to add timing */
  needsTimingFollowup: boolean;
  /** Suggested follow-up prompt, if any */
  suggestedPrompt: string | null;
}

// ── BLOCKER KEYWORDS ──────────────────────────────────────────
// If a task has these in its title or is in 'in_progress' with blockers,
// it's in 'waiting' state.

const WAITING_KEYWORDS: RegExp[] = [
  /\bwait(?:ing)?\s+(?:for|on)\b/i,
  /\bblocked\b/i,
  /\bdepend(?:s|ing)?\s+on\b/i,
  /\bpending\s+(?:approval|review|response|feedback)\b/i,
  /\bneed(?:s)?\s+(?:response|reply|confirmation|approval)\b/i,
];

// ── MAIN FUNCTION ─────────────────────────────────────────────

export function getTaskSchedulingState(task: {
  title: string;
  dueAt: string | null;
  status: string;
}): TaskSchedulingInfo {
  // ── Check for waiting/blocked state ─────────────────────────
  const titleLower = task.title.toLowerCase();
  for (const pattern of WAITING_KEYWORDS) {
    if (pattern.test(titleLower)) {
      return {
        state: 'waiting',
        needsTimingFollowup: false,
        suggestedPrompt: null,
      };
    }
  }

  // ── Scheduled: has due_at ───────────────────────────────────
  if (task.dueAt) {
    return {
      state: 'scheduled',
      needsTimingFollowup: false,
      suggestedPrompt: null,
    };
  }

  // ── Unscheduled: valid but no time ──────────────────────────
  return {
    state: 'unscheduled',
    needsTimingFollowup: true,
    suggestedPrompt: generateTimingPrompt(task.title),
  };
}

// ── TIMING PROMPT GENERATOR ───────────────────────────────────
// Generates a lightweight follow-up prompt for unscheduled tasks.

function generateTimingPrompt(title: string): string {
  const shortTitle = title.length > 40 ? title.slice(0, 40) + '...' : title;
  return `When should "${shortTitle}" happen?`;
}

// ── BATCH SCHEDULING CHECK ────────────────────────────────────
// Returns unscheduled tasks eligible for follow-up prompting.

export function getUnscheduledTasks(tasks: Array<{
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
}>): Array<{
  id: string;
  title: string;
  prompt: string;
}> {
  return tasks
    .filter(t => t.status === 'pending' || t.status === 'in_progress')
    .map(t => ({
      task: t,
      scheduling: getTaskSchedulingState(t),
    }))
    .filter(({ scheduling }) => scheduling.needsTimingFollowup && scheduling.suggestedPrompt)
    .map(({ task, scheduling }) => ({
      id: task.id,
      title: task.title,
      prompt: scheduling.suggestedPrompt!,
    }));
}
