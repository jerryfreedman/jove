// ── SESSION 5: PRIORITIZATION HOOK ──────────────────────────
// Single entry point for consuming truth + prioritization.
// Used by ControlSurface and home page.
//
// Computes once per relevant data change.
// Returns: truthState, prioritization, sunTruth.

'use client';

import { useMemo } from 'react';
import { buildTruthState, type TruthInput, type TruthState } from './buildTruthState';
import { rankNextActions, type PrioritizationInput, type PrioritizationResult } from './rankNextActions';
import { buildSunTruth, type SunTruthState } from './sunTruth';
import { logPrioritizationCycle } from './logger';
import { getMomentum, type MomentumState } from '@/lib/intelligence/momentum';
import type { DisplayTask } from '@/lib/task-queries';
import type { ItemRow, PersonRow, MeetingRow } from '@/lib/types';

// ── HOOK INPUT ──────────────────────────────────────────────

export interface UsePrioritizationInput {
  tasks: DisplayTask[];
  items: ItemRow[];
  people: PersonRow[];
  meetings: MeetingRow[];
}

// ── HOOK OUTPUT ─────────────────────────────────────────────

export interface UsePrioritizationResult {
  truthState: TruthState;
  prioritization: PrioritizationResult;
  sunTruth: SunTruthState;
}

// ── HOOK ────────────────────────────────────────────────────

export function usePrioritization(
  input: UsePrioritizationInput,
): UsePrioritizationResult {
  const currentHour = new Date().getHours();
  const momentumState: MomentumState = getMomentum().state;

  return useMemo(() => {
    // ── 1. Build canonical truth state ──
    const truthInput: TruthInput = {
      tasks: input.tasks,
      items: input.items,
      people: input.people,
      meetings: input.meetings,
      currentHour,
    };
    const truthState = buildTruthState(truthInput);

    // ── 2. Rank next actions ──
    // Session 9: Pass people for stale-relationship candidates
    const prioritizationInput: PrioritizationInput = {
      truthState,
      currentHour,
      momentumState,
      people: input.people,
    };
    const prioritization = rankNextActions(prioritizationInput);

    // ── 3. Build Sun truth ──
    const sunTruth = buildSunTruth(truthState, prioritization, momentumState);

    // ── 4. Log (dev only) ──
    logPrioritizationCycle(truthState, prioritization, sunTruth);

    return { truthState, prioritization, sunTruth };
  }, [input.tasks, input.items, input.people, input.meetings, currentHour, momentumState]);
}
