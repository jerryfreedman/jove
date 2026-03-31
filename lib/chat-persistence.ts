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

/**
 * Persist a single chat message to the chat_messages table.
 * Also increments the message_count on the parent chat_threads row.
 * Fails silently — never breaks the visible chat experience.
 * Returns the inserted row ID on success, null on failure.
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
): Promise<string | null> {
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
      console.error('Chat message persist error:', error);
      return null;
    }

    // Note: message_count on chat_threads is a convenience field.
    // It can be derived from COUNT(*) on chat_messages at query time.
    // Client-side atomic increment is not reliably supported,
    // so we skip updating it here. Future server-side logic can maintain it.

    return data?.id ?? null;
  } catch (err) {
    console.error('Chat message persist exception:', err);
    return null;
  }
}
