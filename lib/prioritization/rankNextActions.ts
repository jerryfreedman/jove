// ── SESSION 5: PRIORITIZATION ENGINE ────────────────────────
// Selects the single most important next action from truth state.
//
// Output: one primary action + up to two secondary actions.
// NOT a flat list. The system decides what deserves attention first.
//
// Scoring is explicit and deterministic.
// Momentum influences tone only, not truth.

import type { TruthState } from './buildTruthState';
import type { DisplayTask } from '@/lib/task-queries';
import type { ItemRow, MeetingRow } from '@/lib/types';
import type { MomentumState } from '@/lib/intelligence/momentum';

// ── RANKED ACTION TYPE ──────────────────────────────────────

export type RankedActionType =
  | 'task'
  | 'prep'
  | 'followup'
  | 'log_notes'
  | 'resolve_blocker'
  | 'review';

export interface RankedAction {
  id: string;
  type: RankedActionType;
  title: string;
  subtitle?: string;
  contextType?: 'task' | 'item' | 'person' | 'event';
  contextId?: string;
  priorityScore: number;
  reason: string;
}

// ── PRIORITIZATION OUTPUT ───────────────────────────────────

export interface PrioritizationResult {
  primaryAction: RankedAction | null;
  secondaryActions: RankedAction[];
  reasoning: string[];
}

// ── INPUT ───────────────────────────────────────────────────

export interface PrioritizationInput {
  truthState: TruthState;
  currentHour: number;
  momentumState: MomentumState;
}

// ── SCORING CONSTANTS ───────────────────────────────────────

const SCORE: Record<string, number> = {
  OVERDUE_BASE: 100,
  DUE_TODAY_BASE: 80,
  DUE_SOON_BASE: 50,
  BLOCKER_BASE: 75,
  PREP_IMMINENT_BASE: 85,   // prep needed within 4h
  PREP_NEAR_BASE: 55,       // prep needed within 24h
  FOLLOWUP_BASE: 40,
  STALE_ITEM_BASE: 30,
  REVIEW_BASE: 20,

  // Bonuses
  HIGH_PRIORITY_BONUS: 15,
  USER_CREATED_BONUS: 10,
  LINKED_CONTEXT_BONUS: 5,
  STRONG_VERB_BONUS: 5,

  // Penalties
  VAGUE_PENALTY: -20,
  SHORT_TITLE_PENALTY: -10,
  STALE_LOW_SIGNAL_PENALTY: -15,

  // Time-of-day tie-breakers (small)
  MORNING_PREP_BONUS: 3,
  WORKDAY_EXECUTION_BONUS: 3,
  EVENING_CLOSURE_BONUS: 3,
};

// ── HELPERS ─────────────────────────────────────────────────

const STRONG_VERBS = new Set([
  'confirm', 'send', 'schedule', 'call', 'prepare', 'lock',
  'draft', 'ask', 'decide', 'align', 'book', 'submit', 'notify',
  'follow', 'review', 'resolve', 'complete', 'finalize', 'update',
]);

const VAGUE_PATTERNS = [
  /^think\s+about/i,
  /^consider\s+/i,
  /^maybe\s+/i,
  /^look\s+into/i,
  /^figure\s+out/i,
];

function isVague(title: string): boolean {
  if (title.trim().split(/\s+/).length <= 2) return true;
  return VAGUE_PATTERNS.some(p => p.test(title));
}

function hasStrongVerb(title: string): boolean {
  const firstWord = title.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return STRONG_VERBS.has(firstWord);
}

function hoursUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60);
}

function hoursSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

// ── CANDIDATE GENERATORS ────────────────────────────────────

function candidatesFromUrgentTasks(tasks: DisplayTask[]): RankedAction[] {
  return tasks.map(t => {
    let score = SCORE.OVERDUE_BASE;
    let reason = 'Overdue';

    if (t.dueAt) {
      const h = hoursUntil(t.dueAt);
      if (h > 0) {
        score = SCORE.DUE_TODAY_BASE;
        reason = h <= 4 ? 'Due in a few hours' : 'Due today';
      } else {
        // More overdue = higher score
        const overHours = Math.abs(h);
        score = SCORE.OVERDUE_BASE + Math.min(overHours, 48);
        reason = overHours > 24 ? 'Overdue by more than a day' : 'Overdue';
      }
    }

    if (t.priority !== null && t.priority <= 5) score += SCORE.HIGH_PRIORITY_BONUS;
    if (t.source === 'user') score += SCORE.USER_CREATED_BONUS;
    if (t.dealId || t.meetingId) score += SCORE.LINKED_CONTEXT_BONUS;
    if (hasStrongVerb(t.title)) score += SCORE.STRONG_VERB_BONUS;
    if (isVague(t.title)) score += SCORE.VAGUE_PENALTY;

    return {
      id: `task-${t.id}`,
      type: 'task' as RankedActionType,
      title: t.title,
      subtitle: t.dueAt ? reason : undefined,
      contextType: 'task' as const,
      contextId: t.id,
      priorityScore: score,
      reason,
    };
  });
}

function candidatesFromDueSoonTasks(tasks: DisplayTask[]): RankedAction[] {
  return tasks.map(t => {
    let score = SCORE.DUE_SOON_BASE;
    const reason = t.dueAt ? `Due in ${Math.round(hoursUntil(t.dueAt))}h` : 'Due soon';

    if (t.source === 'user') score += SCORE.USER_CREATED_BONUS;
    if (hasStrongVerb(t.title)) score += SCORE.STRONG_VERB_BONUS;
    if (isVague(t.title)) score += SCORE.VAGUE_PENALTY;

    return {
      id: `task-${t.id}`,
      type: 'task' as RankedActionType,
      title: t.title,
      subtitle: reason,
      contextType: 'task' as const,
      contextId: t.id,
      priorityScore: score,
      reason,
    };
  });
}

function candidatesFromBlockedItems(items: ItemRow[]): RankedAction[] {
  return items.map(i => {
    const score = SCORE.BLOCKER_BASE;
    const reason = i.status === 'waiting'
      ? 'Waiting — needs follow-up'
      : 'Paused — needs unblocking';

    return {
      id: `blocker-${i.id}`,
      type: 'resolve_blocker' as RankedActionType,
      title: `Unblock ${i.name}`,
      subtitle: reason,
      contextType: 'item' as const,
      contextId: i.id,
      priorityScore: score,
      reason,
    };
  });
}

function candidatesFromPrepNeeds(meetings: MeetingRow[]): RankedAction[] {
  return meetings.map(m => {
    const h = hoursUntil(m.scheduled_at);
    const isImminent = h <= 4;
    const score = isImminent ? SCORE.PREP_IMMINENT_BASE : SCORE.PREP_NEAR_BASE;
    const reason = isImminent
      ? `${m.title} in ${Math.round(h)}h — no prep yet`
      : `No prep yet for ${m.title}`;

    return {
      id: `prep-${m.id}`,
      type: 'prep' as RankedActionType,
      title: `Prep for ${m.title}`,
      subtitle: `In ${Math.round(h)}h`,
      contextType: 'event' as const,
      contextId: m.id,
      priorityScore: score,
      reason,
    };
  });
}

function candidatesFromStaleItems(items: ItemRow[]): RankedAction[] {
  return items.map(i => {
    const days = Math.floor(
      (Date.now() - new Date(i.last_activity_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    let score = SCORE.STALE_ITEM_BASE;

    // Very stale items are slightly more important
    if (days > 14) score += 10;
    // But if they're very old with no context, penalize
    if (!i.notes && days > 21) score += SCORE.STALE_LOW_SIGNAL_PENALTY;

    const reason = `${days}d without progress`;

    return {
      id: `review-${i.id}`,
      type: 'review' as RankedActionType,
      title: `Check in on ${i.name}`,
      subtitle: reason,
      contextType: 'item' as const,
      contextId: i.id,
      priorityScore: score,
      reason,
    };
  });
}

// ── DUPLICATE / CONFLICT SUPPRESSION ────────────────────────

function suppressDuplicates(candidates: RankedAction[]): RankedAction[] {
  const seen = new Map<string, RankedAction>();
  const result: RankedAction[] = [];

  for (const c of candidates) {
    // Key by contextId + contextType to detect overlapping actions
    const contextKey = c.contextId ? `${c.contextType}:${c.contextId}` : null;

    // Check for exact duplicate by id
    if (seen.has(c.id)) continue;

    // Check for context overlap: keep the higher-scoring one
    if (contextKey) {
      const existing = seen.get(contextKey);
      if (existing) {
        if (c.priorityScore > existing.priorityScore) {
          // Replace the weaker one
          const idx = result.indexOf(existing);
          if (idx !== -1) result.splice(idx, 1);
          seen.set(contextKey, c);
          result.push(c);
        }
        // Otherwise skip this lower-scoring duplicate
        continue;
      }
      seen.set(contextKey, c);
    }

    seen.set(c.id, c);
    result.push(c);
  }

  return result;
}

function suppressConflicts(candidates: RankedAction[]): RankedAction[] {
  // If we have both a "review" and a more specific action for the same context, drop the review
  const specificIds = new Set(
    candidates
      .filter(c => c.type !== 'review')
      .map(c => c.contextId)
      .filter(Boolean),
  );

  return candidates.filter(c => {
    if (c.type === 'review' && c.contextId && specificIds.has(c.contextId)) {
      return false;
    }
    return true;
  });
}

// Also suppress title-similar actions (e.g., "Log notes from call" vs "Review call outcome")
function suppressSimilarTitles(candidates: RankedAction[]): RankedAction[] {
  const result: RankedAction[] = [];
  const normalizedTitles = new Set<string>();

  for (const c of candidates) {
    // Normalize: lowercase, strip common prefixes, collapse whitespace
    const normalized = c.title
      .toLowerCase()
      .replace(/^(log|review|check|follow up on|update)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Check if a similar title already exists
    let isDuplicate = false;
    normalizedTitles.forEach(existing => {
      // Simple similarity: if one contains the other, it's similar enough
      if (normalized.includes(existing) || existing.includes(normalized)) {
        isDuplicate = true;
      }
    });

    if (!isDuplicate) {
      normalizedTitles.add(normalized);
      result.push(c);
    }
  }

  return result;
}

// ── TIME-OF-DAY ADJUSTMENTS ─────────────────────────────────

function applyTimeOfDayBonus(candidates: RankedAction[], currentHour: number): RankedAction[] {
  return candidates.map(c => {
    let bonus = 0;

    // Morning (5–11): prep and planning rank slightly higher
    if (currentHour >= 5 && currentHour < 12) {
      if (c.type === 'prep' || c.type === 'review') {
        bonus = SCORE.MORNING_PREP_BONUS;
      }
    }

    // Workday (12–17): execution and follow-up rank slightly higher
    if (currentHour >= 12 && currentHour < 18) {
      if (c.type === 'task' || c.type === 'followup' || c.type === 'resolve_blocker') {
        bonus = SCORE.WORKDAY_EXECUTION_BONUS;
      }
    }

    // Evening (18–23): logging and closure rank slightly higher
    if (currentHour >= 18 || currentHour < 5) {
      if (c.type === 'log_notes' || c.type === 'review') {
        bonus = SCORE.EVENING_CLOSURE_BONUS;
      }
    }

    if (bonus === 0) return c;
    return { ...c, priorityScore: c.priorityScore + bonus };
  });
}

// ── MAIN RANKING FUNCTION ───────────────────────────────────

export function rankNextActions(input: PrioritizationInput): PrioritizationResult {
  const { truthState, currentHour } = input;
  const reasoning: string[] = [];

  // ── 1. Generate all candidate actions ─────────────────────
  let candidates: RankedAction[] = [
    ...candidatesFromUrgentTasks(truthState.urgentTasks),
    ...candidatesFromDueSoonTasks(truthState.dueSoonTasks),
    ...candidatesFromBlockedItems(truthState.blockedItems),
    ...candidatesFromPrepNeeds(truthState.upcomingEventsNeedingPrep),
    ...candidatesFromStaleItems(truthState.activeItemsNeedingProgress),
  ];

  reasoning.push(`Generated ${candidates.length} candidate actions`);

  // ── 2. Suppress duplicates ────────────────────────────────
  const beforeDedup = candidates.length;
  candidates = suppressDuplicates(candidates);
  candidates = suppressConflicts(candidates);
  candidates = suppressSimilarTitles(candidates);

  const suppressed = beforeDedup - candidates.length;
  if (suppressed > 0) {
    reasoning.push(`Suppressed ${suppressed} duplicate/conflicting actions`);
  }

  // ── 3. Apply time-of-day tie-breakers ─────────────────────
  candidates = applyTimeOfDayBonus(candidates, currentHour);

  // ── 4. Sort by priority score (descending — higher = more important) ──
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);

  // ── 5. Select primary + secondary ─────────────────────────
  const primaryAction = candidates[0] ?? null;
  const secondaryActions = candidates.slice(1, 3); // up to 2

  if (primaryAction) {
    reasoning.push(`Primary: "${primaryAction.title}" (score ${primaryAction.priorityScore}, reason: ${primaryAction.reason})`);
  } else {
    reasoning.push('No strong primary action — system is in clear state');
  }

  for (const s of secondaryActions) {
    reasoning.push(`Secondary: "${s.title}" (score ${s.priorityScore})`);
  }

  return {
    primaryAction,
    secondaryActions,
    reasoning,
  };
}
