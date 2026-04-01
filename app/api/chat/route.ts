import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import { getCached, setCached } from '@/lib/context-cache';
import { DEFAULT_DOMAIN_PROFILE, getDomainPromptBlock } from '@/lib/semantic-labels';

export const maxDuration = 30;

type MessageParam = { role: 'user' | 'assistant'; content: string };

export async function POST(request: NextRequest) {
  try {
    const { dealId, userId, messages } = await request.json() as {
      dealId: string;
      userId: string;
      messages: MessageParam[];
    };

    if (!dealId || !userId || !messages) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Check context cache first
    const cacheKey = `chat_context_${dealId}_${userId}`;
    const cachedSystem = getCached(cacheKey);

    let systemPrompt: string;

    if (cachedSystem) {
      systemPrompt = cachedSystem;
    } else {
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

      // Fetch deal context, voice profile, and signals in parallel
      // Session 5: fetch more interactions for prioritization (8 → pick best 5)
      const [dealRes, interactionsRes, voiceRes, kbRes, signalsRes] = await Promise.all([
        supabase
          .from('deals')
          .select('*, accounts(*, contacts(*))')
          .eq('id', dealId)
          .eq('user_id', userId)
          .single(),
        supabase
          .from('interactions')
          .select('type, raw_content, created_at, origin, source_surface')
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(8),
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
        supabase
          .from('signals')
          .select('signal_type, content, confidence_score, created_at')
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .gte('confidence_score', 0.6)
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      const deal = dealRes.data;
      const account = deal?.accounts as { name: string; contacts?: Array<{
        name: string; title: string | null; is_champion: boolean;
        relationship_summary: string | null;
      }> } | null;
      const contacts = (account?.contacts ?? []);
      const voice = voiceRes.data;

      // ── Session 5: Prioritize interactions ──
      // Boost user-confirmed and recent interactions; deprioritize old/system-extracted
      const rawInteractions = (interactionsRes.data ?? []) as Array<{
        type: string; raw_content: string | null; created_at: string;
        origin?: string | null; source_surface?: string | null;
      }>;
      const prioritizedInteractions = rawInteractions
        .map(i => {
          let priority = 0;
          const ageHours = (Date.now() - new Date(i.created_at).getTime()) / (1000 * 60 * 60);
          // Recency boost: last 24h = +3, last 72h = +2, last week = +1
          if (ageHours < 24) priority += 3;
          else if (ageHours < 72) priority += 2;
          else if (ageHours < 168) priority += 1;
          // Origin boost: user-confirmed > user > system_extracted
          if (i.origin === 'user_confirmed') priority += 2;
          else if (i.origin === 'user') priority += 1;
          return { ...i, priority };
        })
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5);

      // ── Session 5: Prioritize signals ──
      // High confidence + recent first; deduplicate by content
      const rawSignals = (signalsRes.data ?? []).filter(
        (s: { confidence_score: number }) => s.confidence_score >= 0.6
      ) as Array<{ signal_type: string; content: string; confidence_score: number; created_at: string }>;
      const seenSignalContent = new Set<string>();
      const prioritizedSignals = rawSignals
        .filter(s => {
          const key = `${s.signal_type}:${s.content.slice(0, 60).toLowerCase()}`;
          if (seenSignalContent.has(key)) return false;
          seenSignalContent.add(key);
          return true;
        })
        .sort((a, b) => {
          // Sort by confidence desc, then recency
          const confDiff = b.confidence_score - a.confidence_score;
          if (Math.abs(confDiff) > 0.1) return confDiff;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        })
        .slice(0, 10);

      const days = deal ? Math.floor(
        (Date.now() - new Date(deal.last_activity_at).getTime()) /
        (1000 * 60 * 60 * 24)
      ) : 0;

      const contactsText = contacts.length > 0
        ? contacts.map(c =>
            `${c.name}${c.title ? ` — ${c.title}` : ''} — champion: ${
              c.is_champion ? 'yes' : 'no'
            }${c.relationship_summary ? ` — ${c.relationship_summary}` : ''}`
          ).join('\n')
        : 'No contacts logged yet.';

      const interactionsText = prioritizedInteractions.length > 0
        ? prioritizedInteractions.map(i => {
            const d = new Date(i.created_at).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric',
            });
            return `${d} | ${i.type} | ${(i.raw_content ?? '').slice(0, 150)}`;
          }).join('\n')
        : 'No interactions logged yet.';

      const voiceText = voice?.opening_style
        ? `Opening: ${voice.opening_style}. Closing: ${voice.closing_style ?? 'varies'}. Formality: ${voice.formality_level ?? 'moderate'}.`
        : 'No voice profile yet — learning from your emails.';

      const signalsText = prioritizedSignals.length > 0
        ? prioritizedSignals.map(s =>
            `- ${s.signal_type}: ${s.content} (${s.confidence_score})`
          ).join('\n')
        : '';

      const kbRows = kbRes.data ?? [];
      const kbText = kbRows.length > 0
        ? kbRows.map(kb => {
            const lines = [`• ${kb.product_name}: ${kb.description}`];
            if (kb.key_features?.length) {
              lines.push(`  Features: ${kb.key_features.join(', ')}`);
            }
            if (kb.target_use_cases?.length) {
              lines.push(`  Use cases: ${kb.target_use_cases.join(', ')}`);
            }
            return lines.join('\n');
          }).join('\n\n')
        : 'Not specified';

      // ── Session 5: Tightened system prompt with response discipline ──
      // ── Session 17C: Universal identity — no sales-specific framing ──
      systemPrompt = `You are Jove — a personal intelligence system.

RESPONSE RULES:
- Be direct. Be specific to this context. Never give generic advice.
- Never use filler phrases like "Great question!" or "Certainly!" or "Based on the context provided...".
- Match the user's energy — brief if they're brief, detailed if they want depth.
- Do NOT restate facts the user already knows (stage, value, contacts) unless specifically asked.
- Do NOT list context back to the user. Use it to inform your answer, not to prove you have it.
- If the user asks a follow-up or short question, answer directly. Do not re-anchor or reintroduce context.
- When you lack context on something, say so briefly. Do not fabricate or speculate about details you don't have.
- When drafting emails, format as:
Subject: [subject line]

[email body]

${getDomainPromptBlock(DEFAULT_DOMAIN_PROFILE)}

CURRENT CONTEXT:
Item: ${deal?.name ?? 'Unknown'}
Account: ${account?.name ?? 'Unknown'}
Stage: ${deal?.stage ?? 'Unknown'}
Value: ${deal?.value ? `$${Number(deal.value).toLocaleString()}` : 'Not set'}
Next Action: ${deal?.next_action ?? 'None set'}
Days Since Last Activity: ${days}
Notes: ${deal?.notes ?? 'None'}

CONTACTS:
${contactsText}

RECENT INTERACTIONS:
${interactionsText}
${signalsText ? `\nCONTEXT SIGNALS (extracted):\n${signalsText}\n` : ''}
VOICE PROFILE:
${voiceText}

USER CONTEXT:
${kbText}`;

      // Cache the assembled system prompt
      setCached(cacheKey, systemPrompt);
    }

    // Handle message history cap — summarize if over 40
    let processedMessages: MessageParam[] = messages;
    if (messages.length > 40) {
      const toSummarize = messages.slice(0, 20);
      const summaryRes = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Summarize this conversation in 3-4 sentences, preserving key decisions and context:\n\n${
            toSummarize.map(m => `${m.role}: ${m.content}`).join('\n')
          }`,
        }],
      });
      const summary = summaryRes.content[0].type === 'text'
        ? summaryRes.content[0].text
        : '';
      processedMessages = [
        { role: 'user', content: `[Previous conversation summary: ${summary}]` },
        { role: 'assistant', content: 'Understood. Continuing from where we left off.' },
        ...messages.slice(20),
      ];
    }

    // Stream response
    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
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
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
