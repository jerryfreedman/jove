import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import { getCached, setCached } from '@/lib/context-cache';

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

      // Fetch deal context and voice profile in parallel
      const [dealRes, interactionsRes, voiceRes] = await Promise.all([
        supabase
          .from('deals')
          .select('*, accounts(*, contacts(*))')
          .eq('id', dealId)
          .eq('user_id', userId)
          .single(),
        supabase
          .from('interactions')
          .select('type, raw_content, created_at')
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('voice_profile')
          .select('*')
          .eq('user_id', userId)
          .single(),
      ]);

      const deal = dealRes.data;
      const account = deal?.accounts as { name: string; contacts?: Array<{
        name: string; title: string | null; is_champion: boolean;
        relationship_summary: string | null;
      }> } | null;
      const contacts = (account?.contacts ?? []);
      const interactions = interactionsRes.data ?? [];
      const voice = voiceRes.data;

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

      const interactionsText = interactions.length > 0
        ? interactions.map(i => {
            const d = new Date(i.created_at).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric',
            });
            return `${d} | ${i.type} | ${(i.raw_content ?? '').slice(0, 150)}`;
          }).join('\n')
        : 'No interactions logged yet.';

      const voiceText = voice?.opening_style
        ? `Opening: ${voice.opening_style}. Closing: ${voice.closing_style ?? 'varies'}. Formality: ${voice.formality_level ?? 'moderate'}.`
        : 'No voice profile yet — learning from your emails.';

      systemPrompt = `You are Jove — an expert sales intelligence assistant for a senior sales professional.
Be direct. Be specific to this deal.
Never give generic sales advice.
Never use filler phrases like "Great question!" or "Certainly!".
Match the user's energy — brief if they're brief, detailed if they want depth.
When drafting emails, always format as:
Subject: [subject line]

[email body]

CURRENT DEAL CONTEXT:
Deal: ${deal?.name ?? 'Unknown'}
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

VOICE PROFILE:
${voiceText}`;

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
