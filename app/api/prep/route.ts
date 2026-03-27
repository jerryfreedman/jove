import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';

export async function POST(request: NextRequest) {
  try {
    const { dealId, userId } = await request.json();
    if (!dealId || !userId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const cookieStore = cookies();
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

    // Fetch all deal context in parallel
    const [dealRes, interactionsRes, signalsRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, accounts(*), contacts(*)')
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
        .from('signals')
        .select('signal_type, content')
        .eq('deal_id', dealId)
        .eq('user_id', userId)
        .eq('is_duplicate', false)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (dealRes.error || !dealRes.data) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const deal = dealRes.data;
    const account = deal.accounts as { name: string } | null;
    const contacts = (deal.contacts ?? []) as Array<{
      name: string; title: string | null; is_champion: boolean;
    }>;
    const interactions = interactionsRes.data ?? [];
    const signals = signalsRes.data ?? [];

    const days = Math.floor(
      (Date.now() - new Date(deal.last_activity_at).getTime()) /
      (1000 * 60 * 60 * 24)
    );

    const contactsText = contacts.length > 0
      ? contacts.map(c =>
          `${c.name}${c.title ? ` — ${c.title}` : ''} — champion: ${c.is_champion ? 'yes' : 'no'}`
        ).join('\n')
      : 'No contacts logged yet.';

    const interactionsText = interactions.length > 0
      ? interactions.map(i => {
          const d = new Date(i.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric',
          });
          return `${d} | ${i.type} | ${(i.raw_content ?? '').slice(0, 200)}`;
        }).join('\n')
      : 'No interactions logged yet.';

    const signalsText = signals.length > 0
      ? signals.map(s => `${s.signal_type} | ${s.content}`).join('\n')
      : 'No signals extracted yet.';

    const userPrompt = `DEAL: ${deal.name}
ACCOUNT: ${account?.name ?? 'Unknown'}
STAGE: ${deal.stage}
VALUE: ${deal.value ? `$${Number(deal.value).toLocaleString()}` : 'Not set'}
NEXT ACTION: ${deal.next_action ?? 'None set'}
NOTES: ${deal.notes ?? 'None'}
DAYS SINCE LAST ACTIVITY: ${days}

CONTACTS:
${contactsText}

RECENT INTERACTIONS (last 5):
${interactionsText}

RECENT SIGNALS:
${signalsText}

Generate exactly this structure:

**SITUATION**
[2-3 sentences — where this deal genuinely stands based only on the data]

**WHO'S IN THE ROOM**
[One line per contact: name — role — what likely matters to them]
If no contacts: 'No contacts logged — add them in the deal drawer.'

**3 SMART QUESTIONS**
1. [Specific to this deal stage and people — not generic]
2. [Specific to this deal stage and people — not generic]
3. [Specific to this deal stage and people — not generic]

**ONE RISK TO WATCH**
[Single sentence — specific to this deal]

**PROPOSED NEXT STEP**
[Single sentence — what to walk out having agreed on]`;

    // Stream response
    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: `You are preparing a senior sales professional for a meeting or deal conversation. Generate a concise, specific meeting brief using ONLY the information provided. Do not invent details. Do not use generic sales advice. Every point must be specific to this deal and these people. Be direct. No filler.`,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Return as streaming response
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
    console.error('Prep API error:', error);
    return NextResponse.json({ error: 'Prep generation failed' }, { status: 500 });
  }
}
