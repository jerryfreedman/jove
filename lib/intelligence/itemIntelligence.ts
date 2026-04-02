// ── SESSION 14: ITEM INTELLIGENCE ENGINE ────────────────────
// Deterministic intelligence layer for items.
// Produces a 1-sentence summary + single next best action
// from real data (tasks, interactions, people).
// No LLM — pure logic, fast, reusable.

import type { TaskRow, InteractionRow, PersonRow } from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────

export type ItemIntelligenceInput = {
  tasks: TaskRow[];
  interactions: InteractionRow[];
  people: PersonRow[];
  now: Date;
};

export type ItemIntelligenceState = 'clear' | 'active' | 'stalled' | 'urgent';

export type ItemIntelligenceOutput = {
  summary: string;
  nextAction: string;
  state: ItemIntelligenceState;
};

// ── HELPERS ────────────────────────────────────────────────

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function isOverdue(task: TaskRow, now: Date): boolean {
  if (!task.due_at) return false;
  return new Date(task.due_at).getTime() < now.getTime();
}

function isDueToday(task: TaskRow, now: Date): boolean {
  if (!task.due_at) return false;
  const due = new Date(task.due_at);
  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

function isActive(task: TaskRow): boolean {
  return task.status === 'pending' || task.status === 'in_progress';
}

function hoursSince(dateStr: string, now: Date): number {
  return (now.getTime() - new Date(dateStr).getTime()) / MS_PER_HOUR;
}

function daysSince(dateStr: string, now: Date): number {
  return (now.getTime() - new Date(dateStr).getTime()) / MS_PER_DAY;
}

/** Check if interaction content suggests follow-up is needed */
function suggestsFollowUp(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes('waiting') ||
    lower.includes('follow up') ||
    lower.includes('follow-up') ||
    lower.includes('next week') ||
    lower.includes('get back to') ||
    lower.includes('pending response')
  );
}

// ── SUMMARY LOGIC ──────────────────────────────────────────

function buildSummary(input: ItemIntelligenceInput): { summary: string; state: ItemIntelligenceState } {
  const { tasks, interactions, now } = input;
  const activeTasks = tasks.filter(isActive);

  // 1. Overdue task → urgent
  const overdueTasks = activeTasks.filter(t => isOverdue(t, now));
  if (overdueTasks.length > 0) {
    return { summary: 'Urgent. Overdue task needs attention.', state: 'urgent' };
  }

  // 2. Task due today → active
  const todayTasks = activeTasks.filter(t => isDueToday(t, now));
  if (todayTasks.length > 0) {
    return { summary: 'Active. Task due today.', state: 'active' };
  }

  // 3. Recent interaction (<24h) → active
  if (interactions.length > 0) {
    const mostRecent = interactions[0]; // already sorted desc
    if (hoursSince(mostRecent.created_at, now) < 24) {
      return { summary: 'In motion. Recent update captured.', state: 'active' };
    }
  }

  // 4. Stale (>3 days no interaction) → stalled
  if (interactions.length > 0) {
    const mostRecent = interactions[0];
    if (daysSince(mostRecent.created_at, now) > 3) {
      return { summary: 'Stalled. No recent activity.', state: 'stalled' };
    }
  }

  // 4b. No interactions at all → stalled
  if (interactions.length === 0 && activeTasks.length === 0) {
    return { summary: 'Stalled. No recent activity.', state: 'stalled' };
  }

  // 5. Default → active
  return { summary: 'Active. Progress ongoing.', state: 'active' };
}

// ── NEXT ACTION LOGIC ──────────────────────────────────────

function buildNextAction(input: ItemIntelligenceInput): string {
  const { tasks, interactions, people, now } = input;
  const activeTasks = tasks.filter(isActive);

  // 1. Overdue task → use its title
  const overdueTasks = activeTasks
    .filter(t => isOverdue(t, now))
    .sort((a, b) => {
      // Most overdue first
      const aTime = a.due_at ? new Date(a.due_at).getTime() : 0;
      const bTime = b.due_at ? new Date(b.due_at).getTime() : 0;
      return aTime - bTime;
    });
  if (overdueTasks.length > 0) {
    return overdueTasks[0].title;
  }

  // 2. Task due today → use its title
  const todayTasks = activeTasks.filter(t => isDueToday(t, now));
  if (todayTasks.length > 0) {
    return todayTasks[0].title;
  }

  // 3. Upcoming task (nearest due date) → use its title
  const upcoming = activeTasks
    .filter(t => t.due_at && new Date(t.due_at).getTime() > now.getTime())
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
  if (upcoming.length > 0) {
    return upcoming[0].title;
  }

  // 4. Derived from recent interaction content
  if (interactions.length > 0) {
    const recent = interactions[0];
    if (hoursSince(recent.created_at, now) < 72 && suggestsFollowUp(recent.raw_content)) {
      return 'Follow up on recent update';
    }
  }

  // 5. Person exists but stale (3+ days no interaction)
  if (people.length > 0) {
    const stalePerson = people.find(p => {
      if (!p.last_interaction_at) return true; // never interacted
      return daysSince(p.last_interaction_at, now) > 3;
    });
    if (stalePerson) {
      return `Reconnect with ${stalePerson.name}`;
    }
  }

  // 5b. Active task without due date → use its title
  if (activeTasks.length > 0) {
    return activeTasks[0].title;
  }

  // 6. Fallback
  return 'Define next step';
}

// ── PUBLIC API ─────────────────────────────────────────────

export function buildItemIntelligence(input: ItemIntelligenceInput): ItemIntelligenceOutput {
  const { summary, state } = buildSummary(input);
  const nextAction = buildNextAction(input);
  return { summary, nextAction, state };
}
