// ── SESSION 15C.1: DUPLICATE INPUT DETECTION ────────────────
// Before creating new interaction/task, check for recent similar entries.
//
// Rules:
// - Same entity + same intent within ~24h → duplicate
// - Similar text content within ~5min → duplicate
// - If match found → do NOT create duplicate
// - Respond: "Already tracking this — here's the latest"
// - Or: update existing item

import { SupabaseClient } from '@supabase/supabase-js';
import { extractSignificantWords, computeRedundancy } from '@/lib/intelligence/dedupe';

// ── DUPLICATE CHECK FOR TASKS ────────────────────────────────

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingId?: string;
  existingTitle?: string;
  reason?: string;
}

/**
 * Check if a task with similar title already exists for this user.
 * Looks at pending/in_progress tasks within the last 24 hours.
 */
export async function checkDuplicateTask(
  supabase: SupabaseClient,
  userId: string,
  title: string,
): Promise<DuplicateCheckResult> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recentTasks, error } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .gte('created_at', cutoff)
    .limit(20);

  if (error || !recentTasks) {
    // On error, allow creation (don't block on safety check failure)
    return { isDuplicate: false };
  }

  const existingTitles = recentTasks.map(t => t.title);
  const redundancy = computeRedundancy(title, existingTitles);

  if (redundancy >= 0.6) {
    // Find the matching task
    const matchIdx = findBestMatch(title, recentTasks);
    if (matchIdx >= 0) {
      return {
        isDuplicate: true,
        existingId: recentTasks[matchIdx].id,
        existingTitle: recentTasks[matchIdx].title,
        reason: `Similar to existing task: "${recentTasks[matchIdx].title}"`,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Check if an interaction with similar content exists recently.
 * Uses a tighter time window (5 minutes) for exact/near-exact duplicates.
 */
export async function checkDuplicateInteraction(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  dealId?: string | null,
): Promise<DuplicateCheckResult> {
  // Short time window for interaction dedup — prevents double-submit
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  let query = supabase
    .from('interactions')
    .select('id, raw_content')
    .eq('user_id', userId)
    .gte('created_at', cutoff)
    .limit(10);

  if (dealId) {
    query = query.eq('deal_id', dealId);
  }

  const { data: recentInteractions, error } = await query;

  if (error || !recentInteractions) {
    return { isDuplicate: false };
  }

  // Check for exact or near-exact content match
  const contentLower = content.toLowerCase().trim();

  for (const interaction of recentInteractions) {
    if (!interaction.raw_content) continue;
    const existingLower = interaction.raw_content.toLowerCase().trim();

    // Exact match
    if (contentLower === existingLower) {
      return {
        isDuplicate: true,
        existingId: interaction.id,
        reason: 'Exact duplicate within last 5 minutes',
      };
    }

    // Very high similarity (substring)
    if (contentLower.includes(existingLower) || existingLower.includes(contentLower)) {
      return {
        isDuplicate: true,
        existingId: interaction.id,
        reason: 'Near-duplicate within last 5 minutes',
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Get a user-friendly duplicate acknowledgment.
 */
export function getDuplicateAcknowledgment(existingTitle?: string): string {
  if (existingTitle) {
    return `Already tracking this — "${existingTitle}"`;
  }
  return 'Already tracking this.';
}

// ── INTERNAL ─────────────────────────────────────────────────

function findBestMatch(
  title: string,
  candidates: Array<{ id: string; title: string }>,
): number {
  const titleWords = extractSignificantWords(title);
  let bestIdx = -1;
  let bestOverlap = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidateWords = extractSignificantWords(candidates[i].title);

    // Check exact case-insensitive match
    if (title.toLowerCase().trim() === candidates[i].title.toLowerCase().trim()) {
      return i;
    }

    // Check word overlap
    const shared = titleWords.filter(w => candidateWords.includes(w));
    const overlap = shared.length / Math.max(titleWords.length, candidateWords.length, 1);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }

  return bestOverlap > 0.5 ? bestIdx : -1;
}
