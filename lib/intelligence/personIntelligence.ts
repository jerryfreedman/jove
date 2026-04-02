// ── SESSION 16: PERSON INTELLIGENCE ENGINE ──────────────────
// Deterministic intelligence layer for people.
// Produces a 1-sentence summary, relative last-interaction time,
// relationship state, and suggested next action.
// No LLM — pure logic, fast, reusable.
// Follows the same pattern as itemIntelligence.ts.

import type { InteractionRow, ItemRow } from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────

export type PersonIntelligenceInput = {
  interactions: InteractionRow[];
  items: ItemRow[];
  now: Date;
};

export type PersonIntelligenceState = 'active' | 'normal' | 'stale' | 'unknown';

export type PersonIntelligenceOutput = {
  summary: string;
  lastInteraction: string;
  nextAction: string;
  state: PersonIntelligenceState;
};

// ── HELPERS ────────────────────────────────────────────────

const MS_PER_MIN  = 1000 * 60;
const MS_PER_HOUR = MS_PER_MIN * 60;
const MS_PER_DAY  = MS_PER_HOUR * 24;

function formatRelativeTime(dateStr: string, now: Date): string {
  const diff = now.getTime() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / MS_PER_MIN);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / MS_PER_HOUR);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / MS_PER_DAY);
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  return `${weeks} weeks ago`;
}

function daysSince(dateStr: string, now: Date): number {
  return (now.getTime() - new Date(dateStr).getTime()) / MS_PER_DAY;
}

/** Check if interaction content suggests an open loop */
function hasOpenLoop(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes('waiting') ||
    lower.includes('follow up') ||
    lower.includes('follow-up') ||
    lower.includes('get back') ||
    lower.includes('pending') ||
    lower.includes('next week') ||
    lower.includes('let me know')
  );
}

// ── STATE LOGIC ────────────────────────────────────────────

function computeState(interactions: InteractionRow[], now: Date): PersonIntelligenceState {
  if (interactions.length === 0) return 'unknown';

  const mostRecent = interactions[0]; // sorted desc by created_at
  const days = daysSince(mostRecent.created_at, now);

  if (days < 3) return 'active';
  if (days <= 10) return 'normal';
  return 'stale';
}

// ── SUMMARY LOGIC ──────────────────────────────────────────

function buildSummary(input: PersonIntelligenceInput): string {
  const { interactions, items, now } = input;

  // No interactions at all
  if (interactions.length === 0 && items.length === 0) {
    return 'Limited context available.';
  }

  if (interactions.length === 0 && items.length > 0) {
    return 'Linked to active item. No recent interaction.';
  }

  const mostRecent = interactions[0];
  const days = daysSince(mostRecent.created_at, now);

  // Recent with items → champion-like
  if (days < 3 && items.length > 0) {
    return 'Recently engaged. Connected to active work.';
  }

  // Recent without items
  if (days < 3) {
    return 'Recently engaged. Responsive.';
  }

  // Has open loop
  if (interactions.length > 0 && hasOpenLoop(mostRecent.raw_content)) {
    return 'Awaiting follow-up.';
  }

  // Stale with items
  if (days > 10 && items.length > 0) {
    return 'Gone quiet. Linked to open work.';
  }

  // Stale without items
  if (days > 10) {
    return 'No recent activity.';
  }

  // Normal range
  if (items.length > 0) {
    return 'Engaged on current item.';
  }

  return 'Some recent interaction.';
}

// ── LAST INTERACTION LOGIC ─────────────────────────────────

function buildLastInteraction(interactions: InteractionRow[], now: Date): string {
  if (interactions.length === 0) return 'No interactions yet';
  return formatRelativeTime(interactions[0].created_at, now);
}

// ── NEXT ACTION LOGIC ──────────────────────────────────────

function buildNextAction(
  name: string,
  input: PersonIntelligenceInput,
  state: PersonIntelligenceState,
): string {
  const { interactions } = input;

  // Stale → reconnect
  if (state === 'stale' || state === 'unknown') {
    return `Reconnect with ${name}`;
  }

  // Recent open loop → follow up
  if (interactions.length > 0 && hasOpenLoop(interactions[0].raw_content)) {
    return `Follow up with ${name}`;
  }

  // Default → check in
  return `Check in with ${name}`;
}

// ── PUBLIC API ─────────────────────────────────────────────

export function buildPersonIntelligence(
  name: string,
  input: PersonIntelligenceInput,
): PersonIntelligenceOutput {
  const state = computeState(input.interactions, input.now);
  const summary = buildSummary(input);
  const lastInteraction = buildLastInteraction(input.interactions, input.now);
  const nextAction = buildNextAction(name, input, state);

  return { summary, lastInteraction, nextAction, state };
}
