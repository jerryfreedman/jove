import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import { getCached, setCached } from '@/lib/context-cache';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { dealId, userId, mode, meetingId } = await request.json();
    if (!dealId || !userId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const isMicro = mode === 'micro';

    // Check context cache first (skip if x-no-cache header set)
    // Include meetingId in cache key so attendee-filtered context isn't reused across meetings
    const noCache = request.headers.get('x-no-cache') === 'true';
    const cacheKey = `prep_${dealId}_${userId}${meetingId ? `_${meetingId}` : ''}`;
    const cachedPrompt = !noCache ? getCached(cacheKey) : null;

    let userPrompt: string;
    // Track context richness for micro mode anti-generic check
    let hasRealContext = false;

    if (cachedPrompt) {
      userPrompt = cachedPrompt;
      hasRealContext = true; // cached means it had context when built
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

      // Fetch all deal context in parallel — reduced limits for sharper context
      const [dealRes, interactionsRes, signalsRes, kbRes] = await Promise.all([
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
          .limit(3),
        supabase
          .from('signals')
          .select('signal_type, content')
          .eq('deal_id', dealId)
          .eq('user_id', userId)
          .eq('is_duplicate', false)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('knowledge_base')
          .select('product_name, description, key_features, target_use_cases')
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
      ]);

      // Fetch meeting attendees separately if meetingId provided
      let meetingAttendeeData: { attendees: string | null } | null = null;
      if (meetingId) {
        const { data } = await supabase
          .from('meetings')
          .select('attendees')
          .eq('id', meetingId)
          .eq('user_id', userId)
          .single();
        meetingAttendeeData = data;
      }

      if (dealRes.error || !dealRes.data) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      }

      const deal = dealRes.data;
      const account = deal.accounts as { name: string; contacts?: Array<{
        name: string; title: string | null; is_champion: boolean;
        relationship_summary: string | null;
      }> } | null;
      const allContacts = (account?.contacts ?? []);
      const interactions = interactionsRes.data ?? [];
      const signals = signalsRes.data ?? [];

      // ── PHASE 1: ATTENDEE FILTERING ──
      // If meetingId was provided and we have attendees, filter contacts
      // to only those actually in the room
      const meetingAttendees = meetingAttendeeData?.attendees ?? null;
      let matchedContacts = allContacts;
      let unmatchedAttendees: string[] = [];

      if (meetingAttendees && meetingAttendees.trim()) {
        const attendeeNames = meetingAttendees
          .split(',')
          .map((n: string) => n.trim().toLowerCase())
          .filter((n: string) => n.length > 0);

        if (attendeeNames.length > 0) {
          const matched: typeof allContacts = [];
          const matchedAttendeeNames = new Set<string>();

          for (const contact of allContacts) {
            const contactLower = contact.name.toLowerCase();
            const isMatch = attendeeNames.some((attendee: string) =>
              contactLower.includes(attendee) || attendee.includes(contactLower)
            );
            if (isMatch) {
              matched.push(contact);
              // Track which attendee names matched
              for (const attendee of attendeeNames) {
                if (contactLower.includes(attendee) || attendee.includes(contactLower)) {
                  matchedAttendeeNames.add(attendee);
                }
              }
            }
          }

          // Unmatched attendees: names from the meeting that didn't match any contact
          unmatchedAttendees = meetingAttendees
            .split(',')
            .map((n: string) => n.trim())
            .filter((n: string) => n.length > 0 && !matchedAttendeeNames.has(n.toLowerCase()));

          // Only use filtered list if we got at least one match
          if (matched.length > 0) {
            matchedContacts = matched;
          }
          // If zero matches, fall back to all contacts
        }
      }

      // ── Track context richness ──
      hasRealContext = signals.length > 0 || interactions.length > 0;

      const days = Math.floor(
        (Date.now() - new Date(deal.last_activity_at).getTime()) /
        (1000 * 60 * 60 * 24)
      );

      // Build contacts text with attendee awareness
      let contactsText: string;
      if (matchedContacts.length > 0) {
        const contactLines = matchedContacts.map(c => {
          let line = `${c.name}${c.title ? ` — ${c.title}` : ''} — champion: ${c.is_champion ? 'yes' : 'no'}`;
          if (c.relationship_summary) {
            line += `\n  Relationship: ${c.relationship_summary}`;
          }
          return line;
        });
        // Add unmatched attendees as plain names
        if (unmatchedAttendees.length > 0) {
          for (const name of unmatchedAttendees) {
            contactLines.push(`${name} — (no contact record)`);
          }
        }
        contactsText = contactLines.join('\n');
      } else {
        contactsText = 'No contacts logged yet.';
      }

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

      userPrompt = `DEAL: ${deal.name}
ACCOUNT: ${account?.name ?? 'Unknown'}
STAGE: ${deal.stage}
VALUE: ${deal.value ? `$${Number(deal.value).toLocaleString()}` : 'Not set'}
NEXT ACTION: ${deal.next_action ?? 'None set'}
NOTES: ${deal.notes ?? 'None'}
DAYS SINCE LAST ACTIVITY: ${days}

CONTACTS${meetingAttendees ? ' (MEETING ATTENDEES)' : ''}:
${contactsText}

RECENT INTERACTIONS (last 3):
${interactionsText}

RECENT SIGNALS:
${signalsText}

WHAT YOU SELL:
${kbText}

Use the product context above to make your prep brief specific.
Reference relevant features or use cases where they apply to
this deal — don't mention products that aren't relevant.

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

      // Cache the assembled context
      setCached(cacheKey, userPrompt);
    }

    // ── MICRO MODE: return 1-2 sentence JSON summary ──
    // Phase 2: Anti-generic enforcement — if no real context, return null
    if (isMicro) {
      if (!hasRealContext && !cachedPrompt) {
        return NextResponse.json({ summary: null });
      }
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 150,
        system: `You are preparing a senior sales professional for their next meeting. Based on the deal context, generate a 1-2 sentence summary of the situation and what to focus on. You MUST reference at least one of: the deal name, account name, a specific signal, or a specific interaction. Be specific to this deal. No markdown. No structure. Just plain text. If the context is insufficient to say something specific, return exactly: null`,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      // If the model returned "null" or empty, don't pretend we have a summary
      if (!text || text.toLowerCase() === 'null') {
        return NextResponse.json({ summary: null });
      }
      return NextResponse.json({ summary: text });
    }

    // ── FULL MODE: Stream response ──
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
