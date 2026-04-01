/**
 * module-priority.ts
 * SESSION 12B — Clean decision-surface evaluation.
 *
 * Single responsibility: determine if the user has enough data
 * to render a meaningful control surface.
 *
 * All item-level priority lives in task-queries.ts (DB) or task-engine.ts (fallback).
 * No module concept. No stage/revenue scoring. No CRM logic.
 */

import { PULSE_CHECK_DEFAULT_DAYS } from './constants';
import type { DealRow, MeetingRow } from './types';

// ── TYPES ──────────────────────────────────────────────────

type DealWithAccount = DealRow & { accounts: { name: string } | null };

export interface SurfaceEvalInput {
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
  systemTaskCount?: number;
}

export interface SurfaceEvalResult {
  isLowDataState: boolean;
}

// ── Legacy type aliases (consumed by ControlSurface imports) ──

export type ModulePriorityInput = SurfaceEvalInput;
export type ModulePriorityResult = SurfaceEvalResult;

// ── HELPERS ────────────────────────────────────────────────

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

/** Check if an item is stale and needs re-engagement. */
export function isNeedsAttention(deal: DealRow): boolean {
  const inactive = getDaysSince(deal.last_activity_at) > PULSE_CHECK_DEFAULT_DAYS;
  const notClosed = deal.stage !== 'Closed Won' && deal.stage !== 'Closed Lost';
  const notSnoozed = !deal.snoozed_until ||
    new Date(deal.snoozed_until) < new Date();
  return inactive && notClosed && notSnoozed;
}

/** Simple staleness score — used only for ordering remaining items. */
export function scoreItemStaleness(deal: DealRow): number {
  const daysSince = getDaysSince(deal.last_activity_at);
  if (daysSince > 21) return 50;
  if (daysSince > 14) return 35;
  if (daysSince > 7)  return 20;
  return 10;
}

// ── SURFACE EVALUATION ─────────────────────────────────────

export function evaluateModulePriority(input: SurfaceEvalInput): SurfaceEvalResult {
  const totalDataPoints = input.allDeals.length + input.meetings.length;
  return {
    isLowDataState: totalDataPoints <= 1,
  };
}
