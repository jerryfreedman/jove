// ── SESSION 15C.1: HISTORY DEDUPLICATION ─────────────────────
// Fix duplicate entries in interaction history like:
// - PROCESSING + PROCESSED versions of the same interaction
// - Multiple entries from rapid re-submit
//
// Rules:
// - Prefer single evolving entry — keep latest status
// - Suppress duplicates in UI rendering
// - History should feel clean, continuous, not noisy

import type { InteractionRow, ExtractionStatus } from '@/lib/types';

/**
 * Deduplicate interaction history for UI rendering.
 * Collapses extraction status variants into single entries.
 * Preserves chronological order. Keeps the most advanced status.
 */
export function dedupeInteractionHistory(
  interactions: InteractionRow[],
): InteractionRow[] {
  if (interactions.length <= 1) return interactions;

  // Group by content fingerprint (same raw_content + deal_id within short time window)
  const groups = new Map<string, InteractionRow[]>();

  for (const interaction of interactions) {
    const key = buildDedupeKey(interaction);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(interaction);
  }

  // For each group, keep the entry with the most advanced status
  const result: InteractionRow[] = [];

  groups.forEach((group) => {
    if (group.length === 1) {
      result.push(group[0]);
      return;
    }

    // Sort by extraction status priority (complete > processing > pending > failed)
    // Then by created_at desc (most recent first)
    group.sort((a: InteractionRow, b: InteractionRow) => {
      const statusDiff = statusPriority(b.extraction_status) - statusPriority(a.extraction_status);
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Keep the best (first after sort)
    result.push(group[0]);
  });

  // Re-sort by created_at desc (most recent first) to maintain history order
  result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return result;
}

// ── INTERNAL ─────────────────────────────────────────────────

/**
 * Build a dedupe key for an interaction.
 * Groups entries that are the same content within a time window.
 */
function buildDedupeKey(interaction: InteractionRow): string {
  // Normalize content for comparison
  const contentKey = (interaction.raw_content ?? '')
    .toLowerCase()
    .trim()
    .slice(0, 100); // First 100 chars for fingerprint

  const dealKey = interaction.deal_id ?? 'none';

  // Round to 10-minute window for time-based grouping
  const timeWindow = Math.floor(
    new Date(interaction.created_at).getTime() / (10 * 60 * 1000)
  );

  return `${contentKey}::${dealKey}::${timeWindow}`;
}

/**
 * Priority ordering for extraction statuses.
 * Higher = more advanced/preferred.
 */
function statusPriority(status: ExtractionStatus): number {
  switch (status) {
    case 'complete': return 4;
    case 'processing': return 3;
    case 'pending': return 2;
    case 'failed': return 1;
    default: return 0;
  }
}
