import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import { getCached, setCached } from '@/lib/context-cache';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { dealId, userId } = await request.json();
    if (!dealId || !userId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Check context cache first
    const cacheKey = `closeplan_${dealId}_${userId}`;
    const cachedPrompt = getCached(cacheKey);

    let userPrompt: string;

    if (cachedPrompt) {
      userPrompt = cachedPrompt;
    } else {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return cookieStore.getAll(); },
            setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
              try {
                cookiesToSet.forEach(({ name, value, options }) =>
                  cookieStore.set(name, value, options as Record<string, unknown>)
                );
              } catch {
                // ignore
              }
            },
          },
        }
      );

      // Fetch full deal context
      const [dealRes, interactionsRes, signalsRes] = await Promise.all([
        supabase
          .from('deals')
          .select('*, accounts(*)')
          .eq('id', dealId)
          .eq('user_id', userId)
          .single(),
        supabase
          .from('interactions')
          .select('type, raw_content, created_at')
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('signals')
          .select('signal_type, content')
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .eq('is_duplicate', false)
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      if (dealRes.error || !dealRes.data) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      }

      const deal         = dealRes.data;
      const account      = deal.accounts as { name: string } | null;
      const interactions = interactionsRes.data ?? [];
      const signals      = signalsRes.data ?? [];

      // Fetch contacts via account
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('name, title, is_champion, relationship_summary')
        .eq('account_id', deal.account_id)
        .eq('user_id', userId);

      const contacts = (contactsData ?? []) as Array<{
        name: string;
        title: string | null;
        is_champion: boolean;
        relationship_summary: string | null;
      }>;

      const days = Math.floor(
        (Date.now() - new Date(deal.last_activity_at).getTime()) /
        (1000 * 60 * 60 * 24)
      );

      const contactsText = contacts.length > 0
        ? contacts.map(c =>
            `${c.name}${c.title ? ` — ${c.title}` : ''} — champion: ${
              c.is_champion ? 'yes' : 'no'
            }${c.relationship_summary ? ` — ${c.relationship_summary}` : ''}`
          ).join('\n')
        : 'No contacts logged yet.';

      const interactionsText = interactions.length > 0
        ? interactions.map((i: { created_at: string; type: string; raw_content: string }) => {
            const d = new Date(i.created_at).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric',
            });
            return `${d} | ${i.type} | ${i.raw_content.slice(0, 200)}`;
          }).join('\n')
        : 'No interactions logged yet.';

      const signalsText = signals.length > 0
        ? signals.map((s: { signal_type: string; content: string }) => `${s.signal_type}: ${s.content}`).join('\n')
        : 'No signals extracted yet.';

      userPrompt = `Generate a strategic close plan for this opportunity.

DEAL: ${deal.name}
ACCOUNT: ${account?.name ?? 'Unknown'}
STAGE: ${deal.stage}
VALUE: ${deal.value ? `$${Number(deal.value).toLocaleString()}` : 'Not set'}
NEXT ACTION: ${deal.next_action ?? 'None set'}
NOTES: ${deal.notes ?? 'None'}
DAYS SINCE LAST ACTIVITY: ${days}
INTEL SCORE: ${Math.round(deal.intel_score ?? 0)}/100
MOMENTUM: ${Math.round(deal.momentum_score ?? 50)}/100

CONTACTS:
${contactsText}

INTERACTION HISTORY:
${interactionsText}

EXTRACTED SIGNALS:
${signalsText}

Generate exactly this structure:

**CLOSE PLAN — ${deal.name.toUpperCase()}**

**CURRENT SITUATION**
[2-3 sentences: where things genuinely stand, key dynamics, momentum]

**STAKEHOLDER MAP**
[For each known contact: Name — Role — Stance — What they care about]
If no contacts: 'No contacts logged — add them in the deal drawer.'

**PATH TO CLOSE**
Step 1: [Specific action — who owns it — realistic timeline]
Step 2: [Specific action — who owns it — realistic timeline]
Step 3: [Specific action — who owns it — realistic timeline]

**RISKS**
[2-3 specific risks for this exact deal — not generic]

**NEXT MESSAGE TO SEND**
[The single most important outreach to make right now — who, what, why]`;

      // Cache the assembled context
      setCached(cacheKey, userPrompt);
    }

    const stream = await anthropic.messages.stream({
      model:      CLAUDE_MODEL,
      max_tokens: 1000,
      system: `You are a senior sales strategist building a close plan.
Use ONLY the information provided. Be specific — name contacts and deals.
Do not use generic sales frameworks or placeholder language.
Every recommendation must be grounded in the actual data provided.`,
      messages: [{ role: 'user', content: userPrompt }],
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
        'Content-Type':     'text/plain; charset=utf-8',
        'Transfer-Encoding':'chunked',
      },
    });

  } catch (error) {
    console.error('Close plan error:', error);
    return NextResponse.json({ error: 'Close plan failed' }, { status: 500 });
  }
}
