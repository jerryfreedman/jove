// ── SESSION 9 + 11B: TASK TYPES ─────────────────────────────
// SystemTask: derived from system state (meetings, deals, activity).
// Session 11B: Tasks can now also be user-created via chat.
// The SystemTask type below represents the in-memory derivation shape.
// For persisted tasks, see TaskRow in types.ts.

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
