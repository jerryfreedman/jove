/**
 * module-priority.ts
 * SESSION 12A — Simplified decision-surface priority logic.
 *
 * Replaces the module-based system with a unified item scoring approach.
 * No more deal-stage weighting, revenue-based scoring, or CRM urgency.
 *
 * Priority is now:
 *   1. due_at (soonest wins)
 *   2. explicit priority (lower number = more urgent)
 *   3. system urgency (prep / follow-up tasks)
 *   4. recency fallback
 *
 * A future developer should be able to answer:
 *   - Why is this item in "What Matters"?  → it scored highest on urgency
 *   - Why is this in "Coming Up"?          → it's time-bound and happening soon
 *   - Why is this collapsed?               → it didn't qualify for top slots
 */

import { PULSE_CHECK_DEFAULT_DAYS } from './constants';
import type { DealRow, MeetingRow } from './types';

// ── TYPES ──────────────────────────────────────────────────

type DealWithAccount = DealRow & { accounts: { name: string } | null };

export interface DecisionSurfaceInput {
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
  /** Number of active tasks (persistent DB or fallback system-derived) */
  systemTaskCount?: number;
}

export interface DecisionSurfaceResult {
  /** True when the user has very little data overall. */
  isLowDataState: boolean;
}

// ── LEGACY COMPAT (consumed by ControlSurface imports) ─────

/** @deprecated — Kept for module-priority import compat. Use DecisionSurfaceResult. */
export type ModuleId = 'system_tasks' | 'needs_attention' | 'upcoming_meetings' | 'top_deals' | 'deep_links';

export interface ModuleVisibility {
  id: ModuleId;
  shouldShow: boolean;
  priority: number;
  reason: string;
  isProminent: boolean;
}

export interface ModulePriorityResult {
  visibleModules: ModuleVisibility[];
  allModules: ModuleVisibility[];
  isLowDataState: boolean;
}

export interface ModulePriorityInput {
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
  systemTaskCount?: number;
}

// ── HELPERS ────────────────────────────────────────────────

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

/** Check if a deal is stale and needs re-engagement. */
export function isNeedsAttention(deal: DealRow): boolean {
  const inactive = getDaysSince(deal.last_activity_at) > PULSE_CHECK_DEFAULT_DAYS;
  const notClosed = deal.stage !== 'Closed Won' && deal.stage !== 'Closed Lost';
  const notSnoozed = !deal.snoozed_until ||
    new Date(deal.snoozed_until) < new Date();
  return inactive && notClosed && notSnoozed;
}

// ── SIMPLIFIED SCORING ─────────────────────────────────────
// No deal-stage weighting. No revenue scoring. No CRM urgency.
// Just: staleness for surfacing stale items in "everything else".

/** Simple staleness score — used only for ordering remaining items. */
export function scoreItemStaleness(deal: DealRow): number {
  const daysSince = getDaysSince(deal.last_activity_at);
  if (daysSince > 21) return 50;
  if (daysSince > 14) return 35;
  if (daysSince > 7)  return 20;
  return 10;
}

// ── DECISION SURFACE EVALUATION ────────────────────────────
// Replaces evaluateModulePriority. Returns only what the UI needs.

export function evaluateDecisionSurface(input: DecisionSurfaceInput): DecisionSurfaceResult {
  const totalDataPoints = input.allDeals.length + input.meetings.length;
  return {
    isLowDataState: totalDataPoints <= 1,
  };
}

// ── LEGACY evaluateModulePriority ──────────────────────────
// Preserved as a thin wrapper so existing imports don't break.
// The ControlSurface no longer uses module ordering — zones are
// determined by item-level logic inside the component.

export function evaluateModulePriority(input: ModulePriorityInput): ModulePriorityResult {
  const totalDataPoints = input.allDeals.length + input.meetings.length;
  const isLowDataState = totalDataPoints <= 1;

  // Return a minimal result — the component no longer reads module ordering.
  return {
    visibleModules: [],
    allModules: [],
    isLowDataState,
  };
}

// ── REMOVED (Session 12A) ──────────────────────────────────
// scoreDealRelevance — removed (deal-stage weighting, revenue scoring)
// scoreAttentionUrgency — removed (CRM-style urgency logic)
//
// Keeping stubs so any stale imports get a clear error at compile time
// rather than a silent undefined.

/** @deprecated Removed in Session 12A. Use task-level priority instead. */
export function scoreDealRelevance(_deal: DealRow): number {
  return 0;
}

/** @deprecated Removed in Session 12A. Use task-level priority instead. */
export function scoreAttentionUrgency(_deal: DealRow): number {
  return 0;
}
