// ── SESSION 9: SYSTEM-DERIVED TASK TYPES ────────────────────
// Tasks are NEVER user-created.
// Tasks are derived from system state: meetings, deals, activity.
// They represent what the user should do next.

export type TaskType =
  | 'meeting_prep'       // upcoming meeting needs preparation
  | 'meeting_followup'   // meeting just ended → log notes / follow up
  | 'deal_next_step'     // deal missing a next step
  | 'reengage';          // deal stalled → re-engage

export type TaskAction =
  | { kind: 'open_prep'; meetingId: string; dealId?: string }
  | { kind: 'open_chat'; dealId?: string; meetingId?: string }
  | { kind: 'open_deal'; dealId: string }
  | { kind: 'open_briefing' };

export type SystemTask = {
  id: string;
  type: TaskType;
  title: string;
  subtitle?: string;         // short context line
  contextId?: string;        // meetingId or dealId
  priority: number;          // lower = more urgent
  timeRelevance?: string;    // e.g. "in 2 hours", "yesterday"
  action: TaskAction;
  createdAt: number;
};
