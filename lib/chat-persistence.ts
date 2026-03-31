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
 * Persist a single chat message to the chat_messages table.
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
    return data?.id ?? null;
  } catch (err) {
    console.error('Chat message persist exception:', err);
    return null;
  }
}
