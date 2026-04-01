import { SupabaseClient } from '@supabase/supabase-js';
import type {
  InteractionType,
  InteractionSourceSurface,
  InteractionOrigin,
  InteractionIntentType,
  InteractionRoutingMetadata,
} from '@/lib/types';
import {
  STREAK_WEEKDAYS_ONLY,
  STREAK_MILESTONE_DAYS,
} from '@/lib/constants';
import { invalidateDealCache, invalidateUserCache } from '@/lib/context-cache';
import { emitReflection } from '@/lib/chat/reflection';

// ── SAVE INTERACTION ──────────────────────────────────────
// Central save path for interactions. Populates memory upgrade
// fields (source_surface, origin, intent_type, etc.) when provided.
export async function saveInteraction(
  supabase: SupabaseClient,
  params: {
    userId: string;
    dealId: string | null;
    type: InteractionType;
    rawContent: string;
    // ── Session 2: Memory upgrade fields ──
    sourceSurface?: InteractionSourceSurface | null;
    meetingId?: string | null;
    origin?: InteractionOrigin | null;
    intentType?: InteractionIntentType | null;
    routingConfidence?: number | null;
    routingMetadata?: InteractionRoutingMetadata | null;
  },
): Promise<{ id: string } | null> {
  const insert: Record<string, unknown> = {
    user_id: params.userId,
    deal_id: params.dealId,
    contact_id: null,
    type: params.type,
    raw_content: params.rawContent.trim(),
    extraction_status: 'pending',
  };

  // Populate memory upgrade fields when provided (null-safe)
  if (params.sourceSurface != null) insert.source_surface = params.sourceSurface;
  if (params.meetingId != null) insert.meeting_id = params.meetingId;
  if (params.origin != null) insert.origin = params.origin;
  if (params.intentType != null) insert.intent_type = params.intentType;
  if (params.routingConfidence != null) insert.routing_confidence = params.routingConfidence;
  if (params.routingMetadata != null) insert.routing_metadata = params.routingMetadata;

  const { data, error } = await supabase
    .from('interactions')
    .insert(insert)
    .select('id')
    .single();

  if (error) throw error;

  // Session 17A: Invalidate LLM context cache after interaction save
  // so next LLM call reflects the new interaction
  if (data?.id) {
    invalidateUserCache(params.userId);
    if (params.dealId) {
      invalidateDealCache(params.dealId);
    }
  }

  return data;
}

// ── UPDATE INTERACTION LINKAGE ────────────────────────────
// Phase 9 (Session 3): When clarification resolves an ambiguous message,
// update the existing saved interaction instead of creating a duplicate.
// Preserves original raw_content, updates linkage + metadata.
// Session 8: Extended to also support correcting contact_id.
// All updates are idempotent — safe to call multiple times.
export async function updateInteractionLinkage(
  supabase: SupabaseClient,
  params: {
    interactionId: string;
    dealId?: string | null;
    contactId?: string | null;
    meetingId?: string | null;
    routingConfidence?: number | null;
    routingMetadata?: InteractionRoutingMetadata | null;
  },
): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (params.dealId !== undefined) update.deal_id = params.dealId;
  if (params.contactId !== undefined) update.contact_id = params.contactId;
  if (params.meetingId !== undefined) update.meeting_id = params.meetingId;
  if (params.routingConfidence != null) update.routing_confidence = params.routingConfidence;
  if (params.routingMetadata != null) update.routing_metadata = params.routingMetadata;

  // Session 8: No-op guard — avoid empty updates
  if (Object.keys(update).length === 0) return true;

  const { error } = await supabase
    .from('interactions')
    .update(update)
    .eq('id', params.interactionId);

  if (error) {
    console.error('Update interaction linkage error:', error);
    return false;
  }
  return true;
}

// ── SESSION 17A: EXTRACTION WITH RETRY ────────────────────
// Replaces fire-and-forget pattern. Retries with exponential backoff.
// Every interaction eventually resolves to complete OR failed with visibility.

const EXTRACTION_MAX_RETRIES = 3;
const EXTRACTION_RETRY_DELAYS = [1000, 3000, 10000];

/**
 * Trigger extraction with automatic retry on failure.
 * Non-blocking — runs in background but retries transient failures.
 * Returns void (fire-and-retry, not fire-and-forget).
 */
export function triggerExtraction(interactionId: string, userId: string): void {
  triggerExtractionWithRetry(interactionId, userId, 0);
}

function triggerExtractionWithRetry(
  interactionId: string,
  userId: string,
  attempt: number,
): void {
  fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interactionId, userId }),
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Extraction API returned ${res.status}`);
      }
      // Session 17A: Emit reflection so surfaces know extraction completed
      // and can refresh to show new signals/scores.
      emitReflection('extraction:complete');
    })
    .catch((err) => {
      if (attempt < EXTRACTION_MAX_RETRIES - 1) {
        const delay = EXTRACTION_RETRY_DELAYS[attempt] ?? 10000;
        console.warn(
          `Extraction retry ${attempt + 1}/${EXTRACTION_MAX_RETRIES} for ${interactionId} in ${delay}ms:`,
          err,
        );
        setTimeout(
          () => triggerExtractionWithRetry(interactionId, userId, attempt + 1),
          delay,
        );
      } else {
        console.error(
          `Extraction permanently failed for interaction ${interactionId} after ${EXTRACTION_MAX_RETRIES} attempts:`,
          err,
        );
        // Session 17A: Emit failure so surfaces can reflect this state
        emitReflection('extraction:failed');
        // The interaction remains with extraction_status: 'pending' or 'processing'.
        // The home page recovery logic will pick it up on next load.
      }
    });
}

// ── UPDATE STREAK ─────────────────────────────────────────
// Exact streak logic from CaptureSheet.tsx
export async function updateStreak(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const today = new Date();
  const dayOfWeek = today.getDay();
  if (STREAK_WEEKDAYS_ONLY && (dayOfWeek === 0 || dayOfWeek === 6)) return;

  const todayStr = today.toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('streak_log')
    .select('id, capture_count')
    .eq('user_id', userId)
    .eq('log_date', todayStr)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('streak_log')
      .update({ capture_count: (existing.capture_count ?? 1) + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('streak_log')
      .insert({ user_id: userId, log_date: todayStr, capture_count: 1 });
  }

  // Trigger logo bloom on home screen
  localStorage.setItem('jove_bloom_trigger', String(Date.now()));

  // Signal pending sun pulse for when home screen mounts (cross-page captures)
  localStorage.setItem('jove_pulse_pending', String(Date.now()));

  // Check for streak milestone — count consecutive days
  const { data: recentLogs } = await supabase
    .from('streak_log')
    .select('log_date')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(120);

  if (recentLogs) {
    let streakCount = recentLogs.length > 0 ? 1 : 0;
    for (let i = 1; i < recentLogs.length; i++) {
      const curr = new Date(recentLogs[i - 1].log_date);
      const prev = new Date(recentLogs[i].log_date);
      const diffDays = Math.round(
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays <= 2) {
        streakCount++;
      } else {
        break;
      }
    }
    if (STREAK_MILESTONE_DAYS.includes(streakCount)) {
      localStorage.setItem('jove_milestone_trigger', String(Date.now()));
    }
  }
}
