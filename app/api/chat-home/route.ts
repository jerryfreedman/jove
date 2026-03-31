import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';

export const maxDuration = 30;

type MessageParam = { role: 'user' | 'assistant'; content: string };

/**
 * POST /api/chat-home
 *
 * Home-screen assistant route. Handles two modes:
 * 1. Pure question (no deal context) — general assistant
 * 2. Question with deal context — deal-aware assistant
 *
 * Does NOT save interactions. The client handles save decisions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      userId: string;
      messages: MessageParam[];
      dealId?: string | null;
    };

    const { userId, messages, dealId } = body;

    if (!userId || !messages?.length) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

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

    // Fetch user's active deals summary for general awareness
    const [dealsRes, signalsRes] = await Promise.all([
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
    ]);

    const deals = dealsRes.data ?? [];
    const signals = signalsRes.data ?? [];

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
          .select('type, raw_content, created_at')
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
      const interactions = interactionsRes.data ?? [];
      const dealSignals = signals.filter(
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
${interactions.length > 0
  ? interactions.map(i => {
      const d = new Date(i.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `  ${d} | ${i.type} | ${(i.raw_content ?? '').slice(0, 120)}`;
    }).join('\n')
  : '  None yet'}

Signals:
${dealSignals.length > 0
  ? dealSignals.map((s: { signal_type: string; content: string }) => `  - ${s.signal_type}: ${s.content}`).join('\n')
  : '  None extracted yet'}
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

RECENT SIGNALS:
${signals.length > 0
  ? signals.slice(0, 10).map((s: { signal_type: string; content: string }) =>
      `  - ${s.signal_type}: ${s.content}`
    ).join('\n')
  : '  None yet'}
`;
    }

    const systemPrompt = `You are Jove — an expert sales intelligence assistant.
You are embedded in the homepage of a CRM built for senior sales professionals.
Be direct. Be specific. Never give generic sales advice.
Never use filler phrases like "Great question!" or "Certainly!".
Match the user's energy — brief if they're brief, detailed if they want depth.
Keep responses concise — this is a mobile-first chat interface.
${contextBlock}`;

    // Cap messages
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
