/**
 * module-priority.ts
 * SESSION 2 — Adaptive module prioritization for the control surface.
 *
 * Determines which modules to show and in what order based on current data.
 * Uses deterministic, explainable rules — not opaque scoring.
 *
 * Reuses existing logic from assistant-trigger.ts and ControlSurface.tsx
 * rather than duplicating "what matters most" evaluation.
 *
 * A future developer should be able to answer:
 *   - Why is this module showing?   → check shouldShow + reason
 *   - Why is it first?              → check priority (lower = higher rank)
 *   - Why is this one hidden?       → shouldShow is false + reason
 */

import { PULSE_CHECK_DEFAULT_DAYS } from './constants';
import type { DealRow, MeetingRow } from './types';

// ── TYPES ──────────────────────────────────────────────────

export type ModuleId = 'system_tasks' | 'needs_attention' | 'upcoming_meetings' | 'top_deals' | 'deep_links';

export interface ModuleVisibility {
  id: ModuleId;
  shouldShow: boolean;
  /** Lower number = higher priority (shown first). */
  priority: number;
  /** Human-readable reason for the current state — for debugging. */
  reason: string;
  /** Whether this module should get prominent (first-position) styling. */
  isProminent: boolean;
}

export interface ModulePriorityResult {
  /** Ordered list of modules to render (visible only, sorted by priority). */
  visibleModules: ModuleVisibility[];
  /** All modules including hidden ones — for debugging / testing. */
  allModules: ModuleVisibility[];
  /** True when the user has very little data overall. */
  isLowDataState: boolean;
}

type DealWithAccount = DealRow & { accounts: { name: string } | null };

export interface ModulePriorityInput {
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
  /** Session 9+11C: Number of active tasks (persistent DB or fallback system-derived) */
  systemTaskCount?: number;
}

// ── HELPERS (reuse patterns from ControlSurface / assistant-trigger) ──

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function minutesUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60);
}

/** Matches the existing isNeedsAttention logic in ControlSurface. */
export function isNeedsAttention(deal: DealRow): boolean {
  const inactive = getDaysSince(deal.last_activity_at) > PULSE_CHECK_DEFAULT_DAYS;
  const notClosed = deal.stage !== 'Closed Won' && deal.stage !== 'Closed Lost';
  const notSnoozed = !deal.snoozed_until ||
    new Date(deal.snoozed_until) < new Date();
  return inactive && notClosed && notSnoozed;
}

/** Active deals: not closed. */
function isActiveDeal(deal: DealRow): boolean {
  return deal.stage !== 'Closed Won' && deal.stage !== 'Closed Lost';
}

// ── DEAL RELEVANCE SCORING ─────────────────────────────────
// Simple deterministic score using existing data fields.
// Higher = more relevant to surface right now.

export function scoreDealRelevance(deal: DealRow): number {
  let score = 0;
  const daysSince = getDaysSince(deal.last_activity_at);

  // Recency: recently active deals score higher
  if (daysSince === 0)      score += 40;
  else if (daysSince <= 2)  score += 30;
  else if (daysSince <= 5)  score += 20;
  else if (daysSince <= 10) score += 10;
  // Stale deals don't get recency points — they belong in Needs Attention

  // Value: higher value deals are worth surfacing
  if (deal.value) {
    if (deal.value >= 50000)     score += 20;
    else if (deal.value >= 10000) score += 12;
    else if (deal.value >= 1000)  score += 6;
    else                          score += 2;
  }

  // Stage significance: later stages are higher priority
  const stageWeight: Record<string, number> = {
    Negotiation: 18,
    Proposal: 14,
    POC: 10,
    Discovery: 6,
    Prospect: 2,
  };
  score += stageWeight[deal.stage] ?? 0;

  // Starred deals get a boost
  if (deal.is_starred) score += 10;

  // Momentum: use existing momentum_score if available
  if (deal.momentum_score > 0) score += Math.min(deal.momentum_score, 15);

  return score;
}

// ── ATTENTION ITEM RANKING ──────────────────────────────────
// Ranks needs-attention items by urgency. Stalest + highest value first.

export function scoreAttentionUrgency(deal: DealRow): number {
  let score = 0;
  const daysSince = getDaysSince(deal.last_activity_at);

  // Staleness is the primary signal
  if (daysSince > 21)      score += 50;
  else if (daysSince > 14) score += 35;
  else                     score += 20;

  // Value amplifies urgency
  if (deal.value) {
    if (deal.value >= 50000)      score += 25;
    else if (deal.value >= 10000) score += 15;
    else if (deal.value >= 1000)  score += 8;
  }

  // Later stages are higher stakes when stale
  const stageUrgency: Record<string, number> = {
    Negotiation: 20,
    Proposal: 15,
    POC: 10,
    Discovery: 5,
    Prospect: 2,
  };
  score += stageUrgency[deal.stage] ?? 0;

  return score;
}

// ── MAIN EVALUATION ─────────────────────────────────────────

export function evaluateModulePriority(input: ModulePriorityInput): ModulePriorityResult {
  const { allDeals, urgentDeals, meetings } = input;
  const now = new Date();

  // ── Compute derived data ──────────────────────────────────

  // Attention items: urgent deals first, fallback to stale from allDeals
  const attentionCandidates = urgentDeals.length > 0
    ? urgentDeals
    : allDeals.filter(isNeedsAttention);
  const hasAttentionItems = attentionCandidates.length > 0;

  // Upcoming meetings: future only
  const upcomingMeetings = meetings.filter(m => new Date(m.scheduled_at) >= now);
  const hasUpcomingMeetings = upcomingMeetings.length > 0;

  // Check if any meeting is very soon (within 2 hours)
  const hasImminentMeeting = upcomingMeetings.some(
    m => minutesUntil(m.scheduled_at) <= 120
  );

  // Check if meetings are today
  const todayStr = now.toDateString();
  const hasTodayMeetings = upcomingMeetings.some(
    m => new Date(m.scheduled_at).toDateString() === todayStr
  );

  // Active deals
  const activeDeals = allDeals.filter(isActiveDeal);
  const hasActiveDeals = activeDeals.length > 0;

  // Low data state: very little overall data
  const totalDataPoints = allDeals.length + meetings.length;
  const isLowDataState = totalDataPoints <= 1;

  // Session 9: System-derived tasks
  const hasSystemTasks = (input.systemTaskCount ?? 0) > 0;

  // ── Evaluate each module ──────────────────────────────────

  const modules: ModuleVisibility[] = [];

  // --- TASKS (Session 9 + 11C) ---
  // Highest priority module: real persistent tasks (user + system)
  if (hasSystemTasks) {
    modules.push({
      id: 'system_tasks',
      shouldShow: true,
      priority: 2,   // above everything else
      reason: `${input.systemTaskCount} task(s) need action`,
      isProminent: false,
    });
  } else {
    modules.push({
      id: 'system_tasks',
      shouldShow: false,
      priority: 2,
      reason: 'No active tasks — module hidden',
      isProminent: false,
    });
  }

  // --- NEEDS ATTENTION ---
  if (hasAttentionItems) {
    // Base priority: 10 (highest)
    // Stays at top unless an imminent meeting overrides
    modules.push({
      id: 'needs_attention',
      shouldShow: true,
      priority: 10,
      reason: `${attentionCandidates.length} deal(s) need attention (stale > ${PULSE_CHECK_DEFAULT_DAYS} days)`,
      isProminent: false, // set after sorting
    });
  } else {
    modules.push({
      id: 'needs_attention',
      shouldShow: false,
      priority: 10,
      reason: 'No stale or urgent deals — module hidden to reduce noise',
      isProminent: false,
    });
  }

  // --- UPCOMING MEETINGS ---
  if (hasUpcomingMeetings) {
    let meetingPriority: number;
    let reason: string;

    if (hasImminentMeeting) {
      // Imminent meeting jumps to near-top priority
      // But doesn't override Needs Attention if there are truly urgent items
      meetingPriority = hasAttentionItems ? 15 : 5;
      reason = hasAttentionItems
        ? 'Meeting soon — high priority but attention items take precedence'
        : 'Meeting imminent — promoted to top position';
    } else if (hasTodayMeetings) {
      meetingPriority = 20;
      reason = 'Meetings today — shown prominently';
    } else {
      meetingPriority = 30;
      reason = 'Future meetings exist — shown in standard position';
    }

    modules.push({
      id: 'upcoming_meetings',
      shouldShow: true,
      priority: meetingPriority,
      reason,
      isProminent: false,
    });
  } else {
    modules.push({
      id: 'upcoming_meetings',
      shouldShow: false,
      priority: 30,
      reason: 'No upcoming meetings — module hidden',
      isProminent: false,
    });
  }

  // --- TOP DEALS ---
  if (hasActiveDeals) {
    modules.push({
      id: 'top_deals',
      shouldShow: true,
      priority: 25,
      reason: `${activeDeals.length} active deal(s) to surface`,
      isProminent: false,
    });
  } else {
    modules.push({
      id: 'top_deals',
      shouldShow: false,
      priority: 25,
      reason: 'No active deals — module hidden',
      isProminent: false,
    });
  }

  // --- DEEP LINKS (always present, always last) ---
  modules.push({
    id: 'deep_links',
    shouldShow: true,
    priority: 100,
    reason: 'Navigation links — always shown, visually secondary',
    isProminent: false,
  });

  // ── Sort and mark prominence ──────────────────────────────
  const sorted = [...modules].sort((a, b) => a.priority - b.priority);

  // The first visible content module (not deep_links) gets prominent styling
  const firstContent = sorted.find(m => m.shouldShow && m.id !== 'deep_links');
  if (firstContent) {
    firstContent.isProminent = true;
  }

  const visibleModules = sorted.filter(m => m.shouldShow);

  return {
    visibleModules,
    allModules: sorted,
    isLowDataState,
  };
}
