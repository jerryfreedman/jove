// ── SESSION 5: TRUTH ENGINE ─────────────────────────────────
// Canonical state of the day. Single source of truth for:
//   - Sun state
//   - Control panel
//   - "Do This Next"
//   - Future compression layer
//
// No parallel truth calculations elsewhere.
// All downstream consumers read from TruthState.

import type { TaskRow, ItemRow, PersonRow, MeetingRow } from '@/lib/types';
import type { DisplayTask } from '@/lib/task-queries';

// ── TRUTH STATE OUTPUT ──────────────────────────────────────

export interface TruthState {
  /** Tasks that are overdue or due today with high urgency */
  urgentTasks: DisplayTask[];
  /** Tasks due within the next 48 hours */
  dueSoonTasks: DisplayTask[];
  /** Items with status 'waiting' or 'paused' that need unblocking */
  blockedItems: ItemRow[];
  /** Active items that haven't seen recent progress */
  activeItemsNeedingProgress: ItemRow[];
  /** Meetings/events in the next 24h that have no associated prep/notes */
  upcomingEventsNeedingPrep: MeetingRow[];
  /** Things the user is waiting on — tasks, items, or people */
  waitingStates: WaitingState[];
  /** True only if nothing urgent, no blockers, no overdue, no imminent prep */
  clearState: boolean;
  /** Compact flags summarizing the day's truth */
  summaryFlags: string[];
}

export interface WaitingState {
  type: 'task' | 'item' | 'person';
  id: string;
}

// ── INPUT SHAPE ─────────────────────────────────────────────

export interface TruthInput {
  tasks: DisplayTask[];
  items: ItemRow[];
  people: PersonRow[];
  meetings: MeetingRow[];
  /** Current local hour (0–23) */
  currentHour: number;
}

// ── CONFIGURATION ───────────────────────────────────────────

const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;       // 48 hours
const PREP_WINDOW_MS = 24 * 60 * 60 * 1000;            // 24 hours
const STALE_ITEM_DAYS = 7;                              // no activity in 7 days

// ── HELPERS ─────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

function isDueWithin(dueAt: string | null, windowMs: number): boolean {
  if (!dueAt) return false;
  const diff = new Date(dueAt).getTime() - Date.now();
  return diff > 0 && diff <= windowMs;
}

// ── BUILD TRUTH STATE ───────────────────────────────────────

export function buildTruthState(input: TruthInput): TruthState {
  const { tasks, items, people, meetings } = input;
  const now = Date.now();

  // ── URGENT TASKS ─────────────────────────────────────────
  // Overdue or due today with high priority
  const urgentTasks = tasks.filter(t => {
    if (t.status === 'done' || t.status === 'skipped') return false;
    if (isOverdue(t.dueAt)) return true;
    // Due within 4 hours
    if (t.dueAt && isDueWithin(t.dueAt, 4 * 60 * 60 * 1000)) return true;
    // Explicit high priority (1–5)
    if (t.priority !== null && t.priority <= 5) return true;
    return false;
  });

  // ── DUE SOON TASKS ───────────────────────────────────────
  // Due within 48 hours but not already urgent
  const urgentIds = new Set(urgentTasks.map(t => t.id));
  const dueSoonTasks = tasks.filter(t => {
    if (t.status === 'done' || t.status === 'skipped') return false;
    if (urgentIds.has(t.id)) return false;
    return isDueWithin(t.dueAt, DUE_SOON_WINDOW_MS);
  });

  // ── BLOCKED ITEMS ────────────────────────────────────────
  // Items in 'waiting' or 'paused' state
  const blockedItems = items.filter(
    i => i.status === 'waiting' || i.status === 'paused',
  );

  // ── ACTIVE ITEMS NEEDING PROGRESS ────────────────────────
  // Active items with no recent activity (stale)
  const activeItemsNeedingProgress = items.filter(i => {
    if (i.status !== 'active') return false;
    return daysSince(i.last_activity_at) >= STALE_ITEM_DAYS;
  });

  // ── UPCOMING EVENTS NEEDING PREP ─────────────────────────
  // Meetings in the next 24h that haven't been prepped or debriefed
  const upcomingEventsNeedingPrep = meetings.filter(m => {
    const scheduledAt = new Date(m.scheduled_at).getTime();
    if (scheduledAt < now) return false; // already passed
    if (scheduledAt - now > PREP_WINDOW_MS) return false; // too far out
    // No prep generated and not debriefed
    return !m.prep_generated && !m.debrief_completed;
  });

  // ── WAITING STATES ───────────────────────────────────────
  const waitingStates: WaitingState[] = [];

  // Tasks in 'in_progress' status (user is actively waiting/working)
  for (const t of tasks) {
    if (t.status === 'in_progress') {
      waitingStates.push({ type: 'task', id: t.id });
    }
  }

  // Items in waiting state
  for (const i of blockedItems) {
    if (i.status === 'waiting') {
      waitingStates.push({ type: 'item', id: i.id });
    }
  }

  // People with stale interactions (if last interaction > 14 days)
  for (const p of people) {
    if (p.last_interaction_at && daysSince(p.last_interaction_at) > 14) {
      waitingStates.push({ type: 'person', id: p.id });
    }
  }

  // ── CLEAR STATE ──────────────────────────────────────────
  const clearState =
    urgentTasks.length === 0 &&
    blockedItems.length === 0 &&
    upcomingEventsNeedingPrep.length === 0 &&
    dueSoonTasks.length === 0;

  // ── SUMMARY FLAGS ────────────────────────────────────────
  const summaryFlags: string[] = [];

  if (urgentTasks.length > 0) {
    summaryFlags.push(`${urgentTasks.length} urgent task${urgentTasks.length > 1 ? 's' : ''}`);
  }
  if (dueSoonTasks.length > 0) {
    summaryFlags.push(`${dueSoonTasks.length} due soon`);
  }
  if (blockedItems.length > 0) {
    summaryFlags.push(`${blockedItems.length} blocked`);
  }
  if (activeItemsNeedingProgress.length > 0) {
    summaryFlags.push(`${activeItemsNeedingProgress.length} stale`);
  }
  if (upcomingEventsNeedingPrep.length > 0) {
    summaryFlags.push(`${upcomingEventsNeedingPrep.length} need prep`);
  }
  if (waitingStates.length > 0) {
    summaryFlags.push(`${waitingStates.length} waiting`);
  }
  if (clearState) {
    summaryFlags.push('clear');
  }

  return {
    urgentTasks,
    dueSoonTasks,
    blockedItems,
    activeItemsNeedingProgress,
    upcomingEventsNeedingPrep,
    waitingStates,
    clearState,
    summaryFlags,
  };
}
