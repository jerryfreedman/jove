import { SupabaseClient } from '@supabase/supabase-js';
import type { InteractionType } from '@/lib/types';
import {
  STREAK_WEEKDAYS_ONLY,
  STREAK_MILESTONE_DAYS,
} from '@/lib/constants';

// ── SAVE INTERACTION ──────────────────────────────────────
// Mirrors the exact insert structure from CaptureSheet.tsx
export async function saveInteraction(
  supabase: SupabaseClient,
  params: {
    userId: string;
    dealId: string | null;
    type: InteractionType;
    rawContent: string;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('interactions')
    .insert({
      user_id: params.userId,
      deal_id: params.dealId,
      contact_id: null,
      type: params.type,
      raw_content: params.rawContent.trim(),
      extraction_status: 'pending',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

// ── TRIGGER EXTRACTION ────────────────────────────────────
// Fire-and-forget pattern from CaptureSheet.tsx
export function triggerExtraction(interactionId: string, userId: string): void {
  fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interactionId, userId }),
  }).catch((err) => console.error('Extraction trigger error:', err));
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
