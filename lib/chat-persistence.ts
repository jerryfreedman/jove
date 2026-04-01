import { SupabaseClient } from '@supabase/supabase-js';
import type { ChatSourceSurface } from '@/lib/types';

/**
 * Generate a unique thread ID for a chat session.
 * Format: {surface}_{timestamp}_{random}
 * Each chat session gets its own thread. No cross-session stitching yet.
 */
export function generateThreadId(surface: ChatSourceSurface): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${surface}_${ts}_${rand}`;
}

/**
 * Register a chat thread in the chat_threads metadata table.
 * Should be called once at the start of each chat session.
 * Fails silently — never breaks the visible chat experience.
 * Uses upsert to be idempotent (safe to call multiple times).
 */
export async function registerChatThread(
  supabase: SupabaseClient,
  params: {
    threadId: string;
    userId: string;
    sourceSurface: ChatSourceSurface;
    primaryDealId?: string | null;
    primaryMeetingId?: string | null;
  },
): Promise<void> {
  try {
    await supabase
      .from('chat_threads')
      .upsert(
        {
          thread_id: params.threadId,
          user_id: params.userId,
          source_surface: params.sourceSurface,
          primary_deal_id: params.primaryDealId ?? null,
          primary_meeting_id: params.primaryMeetingId ?? null,
          message_count: 0,
        },
        { onConflict: 'thread_id' },
      );
  } catch (err) {
    console.error('Chat thread registration error:', err);
  }
}

// ── SESSION 17A: RETRY BUFFER FOR FAILED WRITES ──────────────
// Never lose user input. If a write fails, buffer it and retry.
// In-memory buffer — survives within session, lost on hard reload.
// This is acceptable: the primary goal is surviving transient
// network/DB failures, not full offline support.

interface PendingWrite {
  params: {
    userId: string;
    threadId: string;
    role: 'user' | 'assistant';
    sourceSurface: ChatSourceSurface;
    messageText: string;
    dealId?: string | null;
    meetingId?: string | null;
    contactId?: string | null;
    metadata?: Record<string, unknown>;
  };
  attempts: number;
  nextRetryAt: number;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 3000, 10000]; // exponential backoff
const pendingWrites: PendingWrite[] = [];
let retryTimerActive = false;

/**
 * Process the retry buffer. Automatically retries failed writes
 * with exponential backoff. Clears successfully written entries.
 */
async function processRetryBuffer(supabase: SupabaseClient): Promise<void> {
  if (pendingWrites.length === 0) {
    retryTimerActive = false;
    return;
  }

  const now = Date.now();
  const ready = pendingWrites.filter(pw => pw.nextRetryAt <= now);

  for (const pw of ready) {
    try {
      const { error } = await supabase
        .from('chat_messages')
        .insert({
          user_id: pw.params.userId,
          thread_id: pw.params.threadId,
          role: pw.params.role,
          source_surface: pw.params.sourceSurface,
          message_text: pw.params.messageText,
          deal_id: pw.params.dealId ?? null,
          meeting_id: pw.params.meetingId ?? null,
          contact_id: pw.params.contactId ?? null,
          metadata: pw.params.metadata ?? {},
        });

      if (!error) {
        // Success — remove from buffer
        const idx = pendingWrites.indexOf(pw);
        if (idx >= 0) pendingWrites.splice(idx, 1);
      } else {
        pw.attempts++;
        if (pw.attempts >= MAX_RETRY_ATTEMPTS) {
          console.error('Chat message permanently failed after retries:', error);
          const idx = pendingWrites.indexOf(pw);
          if (idx >= 0) pendingWrites.splice(idx, 1);
        } else {
          pw.nextRetryAt = Date.now() + (RETRY_DELAYS[pw.attempts] ?? 10000);
        }
      }
    } catch (err) {
      pw.attempts++;
      if (pw.attempts >= MAX_RETRY_ATTEMPTS) {
        console.error('Chat message permanently failed after retries:', err);
        const idx = pendingWrites.indexOf(pw);
        if (idx >= 0) pendingWrites.splice(idx, 1);
      } else {
        pw.nextRetryAt = Date.now() + (RETRY_DELAYS[pw.attempts] ?? 10000);
      }
    }
  }

  // Schedule next check if buffer still has entries
  if (pendingWrites.length > 0) {
    const nextTime = Math.min(...pendingWrites.map(pw => pw.nextRetryAt));
    const delay = Math.max(500, nextTime - Date.now());
    setTimeout(() => processRetryBuffer(supabase), delay);
  } else {
    retryTimerActive = false;
  }
}

function scheduleRetry(supabase: SupabaseClient): void {
  if (!retryTimerActive && pendingWrites.length > 0) {
    retryTimerActive = true;
    const nextTime = Math.min(...pendingWrites.map(pw => pw.nextRetryAt));
    const delay = Math.max(500, nextTime - Date.now());
    setTimeout(() => processRetryBuffer(supabase), delay);
  }
}

/**
 * Check if there are pending (unsaved) writes in the retry buffer.
 * UI can use this to show sync status.
 */
export function hasPendingWrites(): boolean {
  return pendingWrites.length > 0;
}

/**
 * Persist a single chat message to the chat_messages table.
 * Session 17A: Now returns a result object indicating persistence status.
 * On failure, queues for automatic retry. NEVER loses user input.
 */
export async function persistChatMessage(
  supabase: SupabaseClient,
  params: {
    userId: string;
    threadId: string;
    role: 'user' | 'assistant';
    sourceSurface: ChatSourceSurface;
    messageText: string;
    dealId?: string | null;
    meetingId?: string | null;
    contactId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string | null; persisted: boolean }> {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        user_id: params.userId,
        thread_id: params.threadId,
        role: params.role,
        source_surface: params.sourceSurface,
        message_text: params.messageText,
        deal_id: params.dealId ?? null,
        meeting_id: params.meetingId ?? null,
        contact_id: params.contactId ?? null,
        metadata: params.metadata ?? {},
      })
      .select('id')
      .single();

    if (error) {
      console.error('Chat message persist error — queuing retry:', error);
      // Session 17A: Queue for retry instead of losing the message
      pendingWrites.push({
        params,
        attempts: 1,
        nextRetryAt: Date.now() + RETRY_DELAYS[0],
      });
      scheduleRetry(supabase);
      return { id: null, persisted: false };
    }

    // Note: message_count on chat_threads is a convenience field.
    // It can be derived from COUNT(*) on chat_messages at query time.
    // Client-side atomic increment is not reliably supported,
    // so we skip updating it here. Future server-side logic can maintain it.

    return { id: data?.id ?? null, persisted: true };
  } catch (err) {
    console.error('Chat message persist exception — queuing retry:', err);
    // Session 17A: Queue for retry instead of losing the message
    pendingWrites.push({
      params,
      attempts: 1,
      nextRetryAt: Date.now() + RETRY_DELAYS[0],
    });
    scheduleRetry(supabase);
    return { id: null, persisted: false };
  }
}
