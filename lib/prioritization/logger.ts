// ── SESSION 5: PRIORITIZATION LOGGER ────────────────────────
// Internal logging for truth + prioritization pipeline.
// No UI exposure. Console-only for now.
//
// Logs:
//   - Truth summary
//   - Candidate action count
//   - Top 3 selected actions
//   - Suppression reasons
//   - Why primaryAction won

import type { TruthState } from './buildTruthState';
import type { PrioritizationResult } from './rankNextActions';
import type { SunTruthState } from './sunTruth';

const PREFIX = '[Jove/Prioritization]';

/**
 * Log the full prioritization pipeline result.
 * Called once per computation cycle.
 */
export function logPrioritizationCycle(
  truthState: TruthState,
  prioritization: PrioritizationResult,
  sunTruth: SunTruthState,
): void {
  if (typeof window === 'undefined') return;

  // Only log in development
  if (process.env.NODE_ENV !== 'development') return;

  console.groupCollapsed(`${PREFIX} Cycle`);

  // ── Truth summary ──
  console.log(`${PREFIX} Truth:`, {
    urgentTasks: truthState.urgentTasks.length,
    dueSoon: truthState.dueSoonTasks.length,
    blocked: truthState.blockedItems.length,
    staleItems: truthState.activeItemsNeedingProgress.length,
    needsPrep: truthState.upcomingEventsNeedingPrep.length,
    waiting: truthState.waitingStates.length,
    clearState: truthState.clearState,
    flags: truthState.summaryFlags,
  });

  // ── Prioritization reasoning ──
  for (const line of prioritization.reasoning) {
    console.log(`${PREFIX} ${line}`);
  }

  // ── Top 3 actions ──
  const top3 = [
    prioritization.primaryAction,
    ...prioritization.secondaryActions,
  ].filter(Boolean).slice(0, 3);

  if (top3.length > 0) {
    console.log(`${PREFIX} Top actions:`);
    for (const a of top3) {
      if (a) {
        console.log(`  ${a.priorityScore} | ${a.type} | "${a.title}" — ${a.reason}`);
      }
    }
  }

  // ── Why primary won ──
  if (prioritization.primaryAction) {
    console.log(
      `${PREFIX} Primary selected: "${prioritization.primaryAction.title}" ` +
      `(score ${prioritization.primaryAction.priorityScore}, type: ${prioritization.primaryAction.type})`,
    );
  } else {
    console.log(`${PREFIX} No primary action — clear state`);
  }

  // ── Sun truth ──
  console.log(`${PREFIX} Sun:`, {
    stateKey: sunTruth.stateKey,
    headline: sunTruth.headline,
    isSettled: sunTruth.isSettled,
    hasNextMove: sunTruth.hasNextMove,
  });

  console.groupEnd();
}
