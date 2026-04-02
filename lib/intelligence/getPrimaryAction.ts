// ── SESSION 17: PRIMARY ACTION ENGINE ─────────────────────────
// Decision engine that identifies the ONE thing the user should do next.
// Draws from tasks, items, and people intelligence.
// Returns a single, verb-led, immediately actionable label.
//
// Priority order (strict):
//   1. Overdue task
//   2. Task due today
//   3. Item next action (active item with recent activity or stale)
//   4. Stale person → "Reconnect with {name}"
//   5. Fallback → "Define your next step"
//
// Rule: must return ONE action. Must be actionable. Must be clear without context.

import type { DisplayTask } from '@/lib/task-queries';
import type { ItemRow, PersonRow } from '@/lib/types';
import { normalizeItemStatus } from '@/lib/types';
import { toAction } from '@/lib/intelligence/action';
import { isWeakAction } from '@/lib/intelligence/action-quality';

// ── TYPES ──────────────────────────────────────────────────

export type PrimaryActionSource = 'task' | 'item' | 'person' | 'clear';

export interface PrimaryAction {
  /** Verb-led label. Always human-readable, always actionable. */
  label: string;
  /** Where this action originates. */
  source: PrimaryActionSource;
  /** ID of the source entity (task, item, or person). */
  sourceId: string;
  /** Short context line (e.g., "Due today", "From EKS Hybrid Node Deal"). */
  context: string;
}

export interface SecondaryAction {
  label: string;
  source: PrimaryActionSource;
  sourceId: string;
  context: string;
}

export interface DecisionEngineOutput {
  primary: PrimaryAction;
  secondaries: SecondaryAction[];
}

// ── INPUT ──────────────────────────────────────────────────

export interface DecisionEngineInput {
  tasks: DisplayTask[];
  items: ItemRow[];
  people: PersonRow[];
  now: Date;
}

// ── HELPERS ────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isOverdue(dueAt: string | null, now: Date): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < now.getTime();
}

function isDueToday(dueAt: string | null, now: Date): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

function daysSince(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / MS_PER_DAY);
}

function isActiveTask(task: DisplayTask): boolean {
  return task.status === 'pending' || task.status === 'in_progress';
}

/** Junk task patterns — suppress from decision engine. */
const JUNK_PATTERNS = [
  /(?:call went|meeting went|demo went|nothing happened)/i,
  /^idk\.?$/i,
  /^nothing\.?$/i,
  /^no update\.?$/i,
  /^waiting\.?$/i,
  /^same\.?$/i,
];

function isJunkTask(title: string): boolean {
  return JUNK_PATTERNS.some(p => p.test(title));
}

/** Normalize a title to verb-led, concise action. */
function normalizeLabel(title: string): string {
  const action = toAction(title);
  if (isWeakAction(action)) {
    // If the normalized form is still weak, try to prefix with a verb
    return action;
  }
  return action;
}

/** Build context string for a task. */
function taskContext(task: DisplayTask, now: Date): string {
  if (task.dueAt && isOverdue(task.dueAt, now)) {
    const hours = Math.abs(
      (now.getTime() - new Date(task.dueAt).getTime()) / (1000 * 60 * 60),
    );
    return hours > 24 ? 'Overdue 1d+' : 'Overdue';
  }
  if (task.dueAt && isDueToday(task.dueAt, now)) {
    return 'Due today';
  }
  if (task.source === 'user') return 'Your task';
  return '';
}

// ── STALE ITEM THRESHOLD ───────────────────────────────────
const STALE_ITEM_DAYS = 7;
const STALE_PERSON_DAYS = 14;

// ── PRIMARY ACTION SELECTION ───────────────────────────────

function selectPrimary(input: DecisionEngineInput): PrimaryAction {
  const { tasks, items, people, now } = input;
  const activeTasks = tasks.filter(t => isActiveTask(t) && !isJunkTask(t.title));

  // ── 1. OVERDUE TASK ─────────────────────────────────────
  const overdueTasks = activeTasks
    .filter(t => isOverdue(t.dueAt, now))
    .sort((a, b) => {
      // Most overdue first
      const aTime = a.dueAt ? new Date(a.dueAt).getTime() : 0;
      const bTime = b.dueAt ? new Date(b.dueAt).getTime() : 0;
      return aTime - bTime;
    });

  if (overdueTasks.length > 0) {
    const t = overdueTasks[0];
    return {
      label: normalizeLabel(t.title),
      source: 'task',
      sourceId: t.id,
      context: taskContext(t, now),
    };
  }

  // ── 2. TASK DUE TODAY ───────────────────────────────────
  const todayTasks = activeTasks.filter(t => isDueToday(t.dueAt, now));
  if (todayTasks.length > 0) {
    const t = todayTasks[0];
    return {
      label: normalizeLabel(t.title),
      source: 'task',
      sourceId: t.id,
      context: taskContext(t, now),
    };
  }

  // ── 3. ITEM NEXT ACTION ─────────────────────────────────
  // Only active items with recent activity OR stale items needing attention.
  const activeItems = items.filter(i => {
    const normalized = normalizeItemStatus(i.status);
    return normalized === 'active' || normalized === 'in_progress';
  });

  // Prioritize items with recent activity, then stale items
  const itemWithAction = activeItems
    .filter(i => {
      const days = daysSince(i.last_activity_at, now);
      // Has recent activity (< 3 days) OR is stale (> STALE_ITEM_DAYS)
      return days < 3 || days >= STALE_ITEM_DAYS;
    })
    .sort((a, b) => {
      // Stale items first (more urgent), then recent
      const aDays = daysSince(a.last_activity_at, now);
      const bDays = daysSince(b.last_activity_at, now);
      const aStale = aDays >= STALE_ITEM_DAYS ? 1 : 0;
      const bStale = bDays >= STALE_ITEM_DAYS ? 1 : 0;
      if (aStale !== bStale) return bStale - aStale;
      // Among stale, most stale first
      if (aStale && bStale) return bDays - aDays;
      // Among recent, most recent first
      return aDays - bDays;
    })[0];

  if (itemWithAction) {
    const days = daysSince(itemWithAction.last_activity_at, now);
    const isStale = days >= STALE_ITEM_DAYS;
    const label = isStale
      ? normalizeLabel(`Follow up on ${itemWithAction.name}`)
      : normalizeLabel(`Update ${itemWithAction.name}`);
    const context = isStale
      ? `${days}d without activity`
      : 'In motion';

    return {
      label,
      source: 'item',
      sourceId: itemWithAction.id,
      context,
    };
  }

  // ── 3b. HIGH-PRIORITY TASK (no due date) ─────────────────
  // If there are active tasks with explicit priority but no due date
  const priorityTasks = activeTasks
    .filter(t => t.priority !== null && t.priority <= 5 && !t.dueAt)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  if (priorityTasks.length > 0) {
    const t = priorityTasks[0];
    return {
      label: normalizeLabel(t.title),
      source: 'task',
      sourceId: t.id,
      context: 'High priority',
    };
  }

  // ── 4. STALE PERSON ─────────────────────────────────────
  const stalePeople = people
    .filter(p => {
      if (!p.last_interaction_at) return true; // Never interacted
      return daysSince(p.last_interaction_at, now) >= STALE_PERSON_DAYS;
    })
    .sort((a, b) => {
      const aDays = a.last_interaction_at ? daysSince(a.last_interaction_at, now) : 999;
      const bDays = b.last_interaction_at ? daysSince(b.last_interaction_at, now) : 999;
      return bDays - aDays;
    });

  if (stalePeople.length > 0) {
    const p = stalePeople[0];
    const days = p.last_interaction_at ? daysSince(p.last_interaction_at, now) : null;
    return {
      label: `Reconnect with ${p.name}`,
      source: 'person',
      sourceId: p.id,
      context: days !== null ? `${days}d since last contact` : 'No recent interaction',
    };
  }

  // ── 5. ANY REMAINING ACTIVE TASK ────────────────────────
  if (activeTasks.length > 0) {
    const t = activeTasks[0];
    return {
      label: normalizeLabel(t.title),
      source: 'task',
      sourceId: t.id,
      context: taskContext(t, now),
    };
  }

  // ── 6. FALLBACK ─────────────────────────────────────────
  return {
    label: "Define your next step",
    source: 'clear',
    sourceId: '',
    context: '',
  };
}

// ── SECONDARY ACTIONS ──────────────────────────────────────

function selectSecondaries(
  input: DecisionEngineInput,
  primary: PrimaryAction,
): SecondaryAction[] {
  const { tasks, items, people, now } = input;
  const secondaries: SecondaryAction[] = [];
  const usedIds = new Set<string>([primary.sourceId]);
  const usedLabels = new Set<string>([primary.label.toLowerCase()]);

  const activeTasks = tasks.filter(t => isActiveTask(t) && !isJunkTask(t.title));

  // ── Remaining tasks (priority order) ────────────────────
  for (const t of activeTasks) {
    if (secondaries.length >= 3) break;
    if (usedIds.has(t.id)) continue;
    const label = normalizeLabel(t.title);
    if (usedLabels.has(label.toLowerCase())) continue;
    if (isWeakAction(label)) continue;

    secondaries.push({
      label,
      source: 'task',
      sourceId: t.id,
      context: taskContext(t, now),
    });
    usedIds.add(t.id);
    usedLabels.add(label.toLowerCase());
  }

  // ── Item actions not selected as primary ─────────────────
  const activeItems = items.filter(i => {
    const normalized = normalizeItemStatus(i.status);
    return (normalized === 'active' || normalized === 'in_progress') && !usedIds.has(i.id);
  });

  for (const item of activeItems) {
    if (secondaries.length >= 3) break;
    const days = daysSince(item.last_activity_at, now);
    if (days < STALE_ITEM_DAYS && days >= 3) continue; // Skip items in normal range
    const label = days >= STALE_ITEM_DAYS
      ? normalizeLabel(`Check in on ${item.name}`)
      : normalizeLabel(`Update ${item.name}`);
    if (usedLabels.has(label.toLowerCase())) continue;
    if (isWeakAction(label)) continue;

    secondaries.push({
      label,
      source: 'item',
      sourceId: item.id,
      context: days >= STALE_ITEM_DAYS ? `${days}d stale` : 'Active',
    });
    usedIds.add(item.id);
    usedLabels.add(label.toLowerCase());
  }

  // ── Person follow-ups ───────────────────────────────────
  const stalePeople = people.filter(p => {
    if (usedIds.has(p.id)) return false;
    if (!p.last_interaction_at) return true;
    return daysSince(p.last_interaction_at, now) >= STALE_PERSON_DAYS;
  });

  for (const p of stalePeople) {
    if (secondaries.length >= 3) break;
    const label = `Reconnect with ${p.name}`;
    if (usedLabels.has(label.toLowerCase())) continue;

    const days = p.last_interaction_at ? daysSince(p.last_interaction_at, now) : null;
    secondaries.push({
      label,
      source: 'person',
      sourceId: p.id,
      context: days !== null ? `${days}d since last contact` : 'New contact',
    });
    usedIds.add(p.id);
    usedLabels.add(label.toLowerCase());
  }

  return secondaries.slice(0, 3);
}

// ── CLEAR STATE CHECK ──────────────────────────────────────

function isTrulyClear(input: DecisionEngineInput): boolean {
  const { tasks, items, people, now } = input;

  // No active tasks
  const activeTasks = tasks.filter(t => isActiveTask(t) && !isJunkTask(t.title));
  if (activeTasks.length > 0) return false;

  // No stale items
  const staleItems = items.filter(i => {
    const normalized = normalizeItemStatus(i.status);
    if (normalized !== 'active' && normalized !== 'in_progress') return false;
    return daysSince(i.last_activity_at, now) >= STALE_ITEM_DAYS;
  });
  if (staleItems.length > 0) return false;

  // No stale people
  const stalePeople = people.filter(p => {
    if (!p.last_interaction_at) return true;
    return daysSince(p.last_interaction_at, now) >= STALE_PERSON_DAYS;
  });
  if (stalePeople.length > 0) return false;

  return true;
}

// ── PUBLIC API ─────────────────────────────────────────────

export function getPrimaryAction(input: DecisionEngineInput): DecisionEngineOutput {
  // Check truly clear state first
  if (isTrulyClear(input)) {
    return {
      primary: {
        label: "You're clear",
        source: 'clear',
        sourceId: '',
        context: 'Nothing needs your attention right now',
      },
      secondaries: [],
    };
  }

  const primary = selectPrimary(input);
  const secondaries = selectSecondaries(input, primary);

  return { primary, secondaries };
}
