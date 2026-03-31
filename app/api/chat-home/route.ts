import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import { getCached, setCached } from '@/lib/context-cache';
import { DEFAULT_DOMAIN_PROFILE, getDomainPromptBlock } from '@/lib/semantic-labels';

export const maxDuration = 30;

type MessageParam = { role: 'user' | 'assistant'; content: string };

/**
 * ResponseContext — grounded awareness passed from the client routing layer.
 * Tells the LLM what just happened so it can respond conversationally
 * without needing to see the system action directly.
 */
type ResponseContext = {
  classification: string;
  actionTaken?: 'saved' | 'linked' | 'created_deal' | 'none';
  linkedDealId?: string | null;
  linkedDealName?: string | null;
  createdDealId?: string | null;
  ambiguity?: boolean;
};

/**
 * POST /api/chat-home
 *
 * Home-screen assistant route. ALWAYS returns a conversational response.
 *
 * Session 5: Context cache, retrieval prioritization, voice/KB parity.
 * Session (assistant-first): Universal LLM response. Capture is silent.
 * ResponseContext gives the LLM grounded awareness of system actions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      userId: string;
      messages: MessageParam[];
      dealId?: string | null;
      responseContext?: ResponseContext | null;
    };

    const { userId, messages, dealId, responseContext } = body;

    if (!userId || !messages?.length) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Session 5: Context cache for data context (keyed by dealId or 'general')
    // Only caches the data block (deals, signals, voice, KB) — NOT the responseContext,
    // which changes per message.
    const cacheKey = `chat_home_${dealId ?? 'general'}_${userId}`;
    let dataContextBlock: string | null = getCached(cacheKey);

    if (!dataContextBlock) {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return cookieStore.getAll(); },
            setAll(cookiesToSet) {
              try {
                cookiesToSet.forEach(({ name, value, options }) =>
                  cookieStore.set(name, value, options)
                );
              } catch {}
            },
          },
        }
      );

      // Build context based on available data
      let contextBlock = '';

      // Fetch user's active deals summary + signals + voice + KB in parallel
      const [dealsRes, signalsRes, voiceRes, kbRes] = await Promise.all([
        supabase
          .from('deals')
          .select('name, stage, last_activity_at, intel_score, momentum_score, accounts(name)')
          .eq('user_id', userId)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .order('last_activity_at', { ascending: false })
          .limit(10),
        supabase
          .from('signals')
          .select('signal_type, content, deal_id, confidence_score, created_at')
          .eq('user_id', userId)
          .gte('confidence_score', 0.6)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('voice_profile')
          .select('*')
          .eq('user_id', userId)
          .single(),
        supabase
          .from('knowledge_base')
          .select('product_name, description, key_features, target_use_cases')
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
      ]);

      const deals = dealsRes.data ?? [];
      const signals = signalsRes.data ?? [];
      const voice = voiceRes.data;
      const kbRows = kbRes.data ?? [];

      // Deduplicate signals across portfolio
      const seenSignalContent = new Set<string>();
      const dedupedSignals = signals.filter((s: { signal_type: string; content: string }) => {
        const key = `${s.signal_type}:${s.content.slice(0, 60).toLowerCase()}`;
        if (seenSignalContent.has(key)) return false;
        seenSignalContent.add(key);
        return true;
      });

      // If a specific deal is referenced, fetch deeper context
      if (dealId) {
        const [dealDetailRes, interactionsRes] = await Promise.all([
          supabase
            .from('deals')
            .select('*, accounts(*, contacts(*))')
            .eq('id', dealId)
            .eq('user_id', userId)
            .single(),
          supabase
            .from('interactions')
            .select('type, raw_content, created_at, origin')
            .eq('deal_id', dealId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(8),
        ]);

        const deal = dealDetailRes.data;
        const account = deal?.accounts as { name: string; contacts?: Array<{
          name: string; title: string | null; is_champion: boolean;
          relationship_summary: string | null;
        }> } | null;
        const contacts = account?.contacts ?? [];
        const rawInteractions = (interactionsRes.data ?? []) as Array<{
          type: string; raw_content: string | null; created_at: string; origin?: string | null;
        }>;

        // Prioritize interactions by recency + origin
        const prioritizedInteractions = rawInteractions
          .map(i => {
            let priority = 0;
            const ageHours = (Date.now() - new Date(i.created_at).getTime()) / (1000 * 60 * 60);
            if (ageHours < 24) priority += 3;
            else if (ageHours < 72) priority += 2;
            else if (ageHours < 168) priority += 1;
            if (i.origin === 'user_confirmed') priority += 2;
            else if (i.origin === 'user') priority += 1;
            return { ...i, priority };
          })
          .sort((a, b) => b.priority - a.priority)
          .slice(0, 5);

        const dealSignals = dedupedSignals.filter(
          (s: { deal_id: string | null }) => s.deal_id === dealId
        );

        const days = deal ? Math.floor(
          (Date.now() - new Date(deal.last_activity_at).getTime()) /
          (1000 * 60 * 60 * 24)
        ) : 0;

        contextBlock = `
FOCUSED DEAL:
Deal: ${deal?.name ?? 'Unknown'} | Account: ${account?.name ?? 'Unknown'}
Stage: ${deal?.stage ?? 'Unknown'} | Value: ${deal?.value ? `$${Number(deal.value).toLocaleString()}` : 'Not set'}
Days since activity: ${days}
Next action: ${deal?.next_action ?? 'None set'}
Notes: ${deal?.notes ?? 'None'}

Contacts: ${contacts.length > 0
  ? contacts.map(c => `${c.name}${c.title ? ` (${c.title})` : ''}${c.is_champion ? ' [champion]' : ''}`).join(', ')
  : 'None logged'}

Recent interactions:
${prioritizedInteractions.length > 0
  ? prioritizedInteractions.map(i => {
      const d = new Date(i.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `  ${d} | ${i.type} | ${(i.raw_content ?? '').slice(0, 120)}`;
    }).join('\n')
  : '  None yet'}
${dealSignals.length > 0
  ? `\nSignals:\n${dealSignals.map((s: { signal_type: string; content: string }) => `  - ${s.signal_type}: ${s.content}`).join('\n')}`
  : ''}
`;
      } else {
        // General portfolio summary
        contextBlock = `
ACTIVE DEALS:
${deals.length > 0
  ? deals.map((d) => {
      const days = Math.floor(
        (Date.now() - new Date(d.last_activity_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      const accounts = d.accounts as unknown;
      const acct = Array.isArray(accounts) ? (accounts[0] as { name: string } | undefined)?.name ?? '' : (accounts as { name: string } | null)?.name ?? '';
      return `  ${d.name}${acct ? ` (${acct})` : ''} — ${d.stage}, ${days}d since activity, intel: ${d.intel_score}, momentum: ${d.momentum_score}`;
    }).join('\n')
  : '  No active deals'}
${dedupedSignals.length > 0
  ? `\nRECENT SIGNALS:\n${dedupedSignals.slice(0, 8).map((s: { signal_type: string; content: string }) =>
      `  - ${s.signal_type}: ${s.content}`
    ).join('\n')}`
  : ''}
`;
      }

      // Voice profile for email drafting parity
      const voiceText = voice?.opening_style
        ? `\nVOICE PROFILE:\nOpening: ${voice.opening_style}. Closing: ${voice.closing_style ?? 'varies'}. Formality: ${voice.formality_level ?? 'moderate'}.`
        : '';

      // KB context for product awareness
      const kbText = kbRows.length > 0
        ? `\nWHAT YOU SELL:\n${kbRows.map(kb => {
            const lines = [`• ${kb.product_name}: ${kb.description}`];
            if (kb.key_features?.length) lines.push(`  Features: ${kb.key_features.join(', ')}`);
            return lines.join('\n');
          }).join('\n')}`
        : '';

      dataContextBlock = `${contextBlock}${voiceText}${kbText}`;

      // Cache the data context (NOT the response context)
      setCached(cacheKey, dataContextBlock);
    }

    // ── Build final system prompt: static rules + per-message responseContext + cached data ──
    const responseCtxBlock = responseContext
      ? `
SYSTEM CONTEXT:
- Classification: ${responseContext.classification}
- Action taken: ${responseContext.actionTaken ?? 'none'}
- Linked deal: ${responseContext.linkedDealName ?? responseContext.linkedDealId ?? 'none'}
- Ambiguity: ${responseContext.ambiguity ?? false}
`
      : '';

    const systemPrompt = `You are Jove, a personal intelligence assistant.

You help the user manage deals, relationships, and decisions using their real data.
You always respond conversationally, clearly, and helpfully.

---
${responseCtxBlock}
You have access to structured memory: deals, contacts, interactions, and recent activity.

---

RULES:
1. ALWAYS respond conversationally.
2. NEVER respond with system outputs like "Saved.", "Captured.", or "Logged."
3. Capture and system actions happen silently unless useful to mention naturally.
4. Use real context when it improves the answer:
   - Reference deals, contacts, or recent events by name.
   - Avoid generic advice if specific context exists.
5. If no useful context exists, respond naturally like a helpful assistant.
6. If the user asks what happened, explain truthfully based on system context. Do not invent or guess.
7. Do NOT hallucinate. If data is not available, do not fabricate it.
8. Do NOT over-explain system actions. If you saved something, acknowledge it briefly and naturally within a useful response — never make "I saved that" the entire response.
9. If your response could be given by a generic assistant with no memory, improve it using available context (if relevant).
10. Prioritize usefulness over completeness.
11. Match the user's energy — brief if they're brief, detailed if they want depth.
12. Keep responses concise — this is a mobile-first chat interface.
13. Never use filler phrases like "Great question!" or "Certainly!" or "Based on the context provided...".
14. When drafting emails, format as:
Subject: [subject line]

[email body]

---

Your goal is to feel like a system that knows the user, remembers everything important, and helps them move forward.

${getDomainPromptBlock(DEFAULT_DOMAIN_PROFILE)}
${dataContextBlock}`;

    // Cap messages — keep last 20
    let processedMessages: MessageParam[] = messages;
    if (messages.length > 30) {
      processedMessages = messages.slice(-20);
    }

    // Stream response
    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: processedMessages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error('Chat-home API error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
