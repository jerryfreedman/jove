import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import { getCached, setCached } from '@/lib/context-cache';
import { DEFAULT_DOMAIN_PROFILE, getDomainPromptBlock } from '@/lib/semantic-labels';
// Session 11B: Task intent detection + creation
import { detectTaskIntent } from '@/lib/task-intent';
import { parseTaskTime, formatDueAt } from '@/lib/task-time-parser';
import { createUserTask } from '@/lib/task-persistence';
// Session 11F: Universal routing + persistence
import { routeUniversalIntent, type UniversalRoutingResult } from '@/lib/universal-routing';
import {
  createTaskFromIntent,
  createItemFromIntent,
  findOrCreatePerson,
  createEventFromIntent,
} from '@/lib/universal-persistence';

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
  // Session 11B: Task creation context
  taskCreated?: boolean;
  taskTitle?: string | null;
  taskDueLabel?: string | null;
  // Session 11F: Universal routing context
  itemCreated?: boolean;
  itemName?: string | null;
  eventCreated?: boolean;
  eventTitle?: string | null;
  eventTimeLabel?: string | null;
  personLinked?: boolean;
  personName?: string | null;
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

    // ── Session 11F: Universal routing on latest user message ──
    // Detects tasks, items, people, and events server-side.
    // Creates entities and injects confirmation context for the LLM.
    // Falls back to Session 11B task-only detection if universal routing doesn't match.
    interface UniversalContext {
      taskCreated: boolean;
      taskTitle: string | null;
      taskDueLabel: string | null;
      itemCreated: boolean;
      itemName: string | null;
      eventCreated: boolean;
      eventTitle: string | null;
      eventTimeLabel: string | null;
      personLinked: boolean;
      personName: string | null;
    }
    let universalCtx: UniversalContext | null = null;

    const latestUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (latestUserMsg) {
      const universalRoute = routeUniversalIntent(latestUserMsg.content);

      if (universalRoute) {
        // Create Supabase client for writes
        const writeCookieStore = await cookies();
        const writeSupabase = createServerClient(
          SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() { return writeCookieStore.getAll(); },
              setAll(cookiesToSet) {
                try {
                  cookiesToSet.forEach(({ name, value, options }) =>
                    writeCookieStore.set(name, value, options)
                  );
                } catch {}
              },
            },
          }
        );

        universalCtx = {
          taskCreated: false, taskTitle: null, taskDueLabel: null,
          itemCreated: false, itemName: null,
          eventCreated: false, eventTitle: null, eventTimeLabel: null,
          personLinked: false, personName: null,
        };

        // 1. Person (needed for linking to other entities)
        let personId: string | null = null;
        if (universalRoute.person) {
          const personResult = await findOrCreatePerson(
            writeSupabase, userId, universalRoute.person
          );
          if (personResult) {
            personId = personResult.id;
            universalCtx.personLinked = true;
            universalCtx.personName = universalRoute.person.name;
          }
        }

        // 2. Item (needed before task for linking)
        let itemId: string | null = null;
        if (universalRoute.item) {
          const itemResult = await createItemFromIntent(
            writeSupabase, userId, { name: universalRoute.item.name }
          );
          if (itemResult) {
            itemId = itemResult.id;
            universalCtx.itemCreated = true;
            universalCtx.itemName = universalRoute.item.name;
          }
        }

        // 3. Task
        if (universalRoute.task) {
          const taskResult = await createTaskFromIntent(
            writeSupabase, userId, {
              title: universalRoute.task.title,
              dueAt: universalRoute.task.dueAt,
              itemId: universalRoute.links.taskToItem ? itemId : null,
              dealId: dealId ?? null,
              personId: universalRoute.links.taskToPerson ? personId : null,
            }
          );
          if (taskResult) {
            universalCtx.taskCreated = true;
            universalCtx.taskTitle = universalRoute.task.title;
            universalCtx.taskDueLabel = universalRoute.task.dueAt
              ? formatDueAt(universalRoute.task.dueAt)
              : null;
          }
        }

        // 4. Event
        if (universalRoute.event) {
          const eventResult = await createEventFromIntent(
            writeSupabase, userId, {
              title: universalRoute.event.title,
              scheduledAt: universalRoute.event.scheduledAt,
              eventType: universalRoute.event.eventType,
              personId: universalRoute.links.eventToPerson ? personId : null,
            }
          );
          if (eventResult) {
            universalCtx.eventCreated = true;
            universalCtx.eventTitle = universalRoute.event.title;
            universalCtx.eventTimeLabel = universalRoute.event.scheduledAt
              ? formatDueAt(universalRoute.event.scheduledAt)
              : null;
          }
        }
      } else {
        // Fallback: Session 11B task-only detection
        const taskIntent = detectTaskIntent(latestUserMsg.content);
        if (taskIntent) {
          const dueAt = taskIntent.rawTimePart
            ? parseTaskTime(taskIntent.rawTimePart)
            : null;

          const taskCookieStore = await cookies();
          const taskSupabase = createServerClient(
            SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
              cookies: {
                getAll() { return taskCookieStore.getAll(); },
                setAll(cookiesToSet) {
                  try {
                    cookiesToSet.forEach(({ name, value, options }) =>
                      taskCookieStore.set(name, value, options)
                    );
                  } catch {}
                },
              },
            }
          );

          const result = await createUserTask(taskSupabase, userId, {
            title: taskIntent.title,
            dueAt,
            dealId: dealId ?? null,
          });

          if (result) {
            universalCtx = {
              taskCreated: true,
              taskTitle: taskIntent.title,
              taskDueLabel: dueAt ? formatDueAt(dueAt) : null,
              itemCreated: false, itemName: null,
              eventCreated: false, eventTitle: null, eventTimeLabel: null,
              personLinked: false, personName: null,
            };
          }
        }
      }
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
    // Session 11F: Merge universal routing context into response context
    const universalFields = universalCtx ? {
      ...(universalCtx.taskCreated ? {
        taskCreated: true,
        taskTitle: universalCtx.taskTitle,
        taskDueLabel: universalCtx.taskDueLabel,
      } : {}),
      ...(universalCtx.itemCreated ? {
        itemCreated: true,
        itemName: universalCtx.itemName,
      } : {}),
      ...(universalCtx.eventCreated ? {
        eventCreated: true,
        eventTitle: universalCtx.eventTitle,
        eventTimeLabel: universalCtx.eventTimeLabel,
      } : {}),
      ...(universalCtx.personLinked ? {
        personLinked: true,
        personName: universalCtx.personName,
      } : {}),
    } : {};

    const hasUniversalAction = universalCtx && (
      universalCtx.taskCreated || universalCtx.itemCreated ||
      universalCtx.eventCreated || universalCtx.personLinked
    );

    const mergedResponseContext = responseContext
      ? { ...responseContext, ...universalFields }
      : hasUniversalAction
        ? {
            classification: 'universal_routing',
            actionTaken: 'none' as const,
            ...universalFields,
          }
        : null;

    const responseCtxBlock = mergedResponseContext
      ? `
SYSTEM CONTEXT:
- Classification: ${mergedResponseContext.classification}
- Action taken: ${mergedResponseContext.actionTaken ?? 'none'}
- Linked deal: ${mergedResponseContext.linkedDealName ?? mergedResponseContext.linkedDealId ?? 'none'}
- Ambiguity: ${mergedResponseContext.ambiguity ?? false}
${mergedResponseContext.taskCreated ? `- Task created: "${mergedResponseContext.taskTitle}"${mergedResponseContext.taskDueLabel ? ` (due ${mergedResponseContext.taskDueLabel})` : ''}` : ''}
${mergedResponseContext.itemCreated ? `- Item/project created: "${mergedResponseContext.itemName}"` : ''}
${mergedResponseContext.eventCreated ? `- Event created: "${mergedResponseContext.eventTitle}"${mergedResponseContext.eventTimeLabel ? ` (${mergedResponseContext.eventTimeLabel})` : ''}` : ''}
${mergedResponseContext.personLinked ? `- Person linked: ${mergedResponseContext.personName}` : ''}
`
      : '';

    const systemPrompt = `You are Jove, a personal intelligence assistant.

You help the user manage deals, relationships, and decisions using their real data.

---
${responseCtxBlock}
You have access to structured memory: deals, contacts, interactions, and recent activity.

---

VOICE:
Follow this pattern for every response: Acknowledge, Confirm, Offer.
- Acknowledge what the user said or did.
- Confirm what happened or what you know.
- Offer a next step if useful.

Examples:
- "Got it — I marked that meeting as cancelled. Want to reschedule it?"
- "All set. You're clear for now."
- "Noted. That's linked to the Acme deal."

RULES:
1. ALWAYS respond conversationally. Short, direct, no fluff.
2. NEVER respond with system outputs like "Saved.", "Captured.", or "Logged."
3. Capture and system actions happen silently unless useful to mention naturally.
4. When a meeting mutation happens (cancelled, moved, completed), acknowledge it naturally and briefly.
5. Use real context when it improves the answer — reference deals, contacts, or recent events by name.
6. If no useful context exists, respond naturally. Don't pad.
7. If the user asks what happened, explain truthfully. Do not invent or guess.
8. Do NOT hallucinate. If data is not available, do not fabricate it.
9. Do NOT over-explain. One sentence is often enough.
10. Prioritize usefulness over completeness.
11. Match the user's energy — brief if they're brief, detailed if they want depth.
12. Keep responses concise — this is a mobile-first chat interface.
13. Never use filler: no "Great question!", no "Certainly!", no "Based on the context provided...".
14. No emojis. No questions unless offering a clear next step.
15. When drafting emails, format as:
Subject: [subject line]

[email body]
16. When a task was created (see SYSTEM CONTEXT), confirm it briefly and naturally. Examples:
    - "Got it — I added that as a task for tomorrow."
    - "Added. That's now on your list."
    - "I captured that. No due time yet — want me to add one?"
    Do NOT say "task created" or use system language. Sound human.
17. When an item/project was created, confirm naturally. Examples:
    - "Added — I'm treating that as a project."
    - "Got it. I set that up as an ongoing focus area."
    Do NOT say "item created" or expose internal language.
18. When an event was created, confirm with the time. Examples:
    - "I put that on your calendar for 7."
    - "Done — you've got gym at 6."
    Do NOT say "event record created" or use system language.
19. When a person was linked, mention them naturally. Examples:
    - "Noted — I linked that to Sarah."
    - "Got it. I'll remember that's about your mom."
    Do NOT say "person entity created" or expose IDs.

---

Your goal: feel like a system that knows the user, remembers everything, and helps them move forward.

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
