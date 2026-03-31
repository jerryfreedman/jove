import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';
import type { SignalType } from '@/lib/types';

export const maxDuration = 30;

// ── VALID SIGNAL TYPES ─────────────────────────────────────
const VALID_SIGNAL_TYPES: SignalType[] = [
  'champion_identified', 'timeline_mentioned', 'budget_mentioned',
  'competitor_mentioned', 'objection_raised', 'positive_sentiment',
  'negative_sentiment', 'next_step_agreed', 'stakeholder_mentioned',
  'technical_requirement', 'commercial_signal', 'relationship_context',
  'idea_captured', 'risk_identified', 'opportunity_identified',
];

// ── DEDUPLICATION CHECK ────────────────────────────────────
function isDuplicate(newContent: string, existingContent: string): boolean {
  const a = newContent.toLowerCase();
  const b = existingContent.toLowerCase();
  if (a.includes(b) || b.includes(a)) return true;
  // Check for 6+ consecutive word overlap
  const wordsA = a.split(/\s+/);
  const wordsB = new Set(b.split(/\s+/));
  let consecutive = 0;
  let maxConsecutive = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  return maxConsecutive >= 6;
}

// ── DEAL SCORE CALCULATION ─────────────────────────────────
function calculateIntelScore(signals: Array<{ signal_type: string; is_duplicate: boolean }>): number {
  const active = signals.filter(s => !s.is_duplicate);
  let score = Math.min(active.length * 8, 60);
  if (active.some(s => s.signal_type === 'champion_identified'))  score += 15;
  if (active.some(s => s.signal_type === 'timeline_mentioned'))   score += 10;
  if (active.some(s => s.signal_type === 'budget_mentioned'))     score += 10;
  if (active.some(s => s.signal_type === 'next_step_agreed'))     score += 8;
  return Math.min(score, 100);
}

function calculateMomentumScore(
  signals: Array<{ signal_type: string; created_at: string; is_duplicate: boolean }>
): number {
  const now     = Date.now();
  const day14   = 14 * 24 * 60 * 60 * 1000;
  const day7    = 7  * 24 * 60 * 60 * 1000;
  const recent14 = signals.filter(s =>
    !s.is_duplicate && (now - new Date(s.created_at).getTime()) < day14
  );
  const recent7  = signals.filter(s =>
    !s.is_duplicate && (now - new Date(s.created_at).getTime()) < day7
  );

  let score = 50;
  for (const s of recent14) {
    if (s.signal_type === 'positive_sentiment')              score += 8;
    if (s.signal_type === 'negative_sentiment')              score -= 10;
    if (s.signal_type === 'objection_raised')                score -= 10;
  }
  for (const s of recent7) {
    if (s.signal_type === 'next_step_agreed')                score += 12;
  }
  if (recent14.length === 0)                                 score -= 15;
  return Math.max(0, Math.min(100, score));
}

function calculateSignalVelocity(
  signals: Array<{ created_at: string; is_duplicate: boolean }>
): number {
  const day7   = 7 * 24 * 60 * 60 * 1000;
  const recent = signals.filter(s =>
    !s.is_duplicate &&
    (Date.now() - new Date(s.created_at).getTime()) < day7
  );
  return Math.round((recent.length / 7) * 100) / 100;
}

// ── MAIN HANDLER ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const interactionId = body.interactionId;
    let userId = body.userId;

    if (!interactionId || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Phase 5: Prefer session userId over body userId when available
    const cookieStore = await cookies();
    try {
      const sessionSupabase = createServerClient(
        SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return cookieStore.getAll(); },
            setAll() { /* read-only check */ },
          },
        }
      );
      const { data: { user } } = await sessionSupabase.auth.getUser();
      if (user?.id) {
        userId = user.id; // Trust session over body
      }
    } catch {
      // Session check failed — continue with body userId
      // Documented risk: body userId is trusted as fallback
    }
    const supabase = createServerClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
              });
            } catch {
              // Ignore cookie errors in API routes
            }
          },
        },
      }
    );

    // ── FETCH INTERACTION ─────────────────────────────────
    const { data: interaction, error: fetchError } = await supabase
      .from('interactions')
      .select('*')
      .eq('id', interactionId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !interaction) {
      return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
    }

    // Mark as processing
    await supabase
      .from('interactions')
      .update({ extraction_status: 'processing' })
      .eq('id', interactionId);

    // ── FETCH DEAL CONTEXT ────────────────────────────────
    let dealContext = '';
    if (interaction.deal_id) {
      const { data: deal } = await supabase
        .from('deals')
        .select('name, stage, accounts(name)')
        .eq('id', interaction.deal_id)
        .single();

      if (deal) {
        const accountName = (deal.accounts as unknown as { name: string } | null)?.name ?? 'Unknown account';
        dealContext = `\nDEAL CONTEXT: ${deal.name} — Stage: ${deal.stage} — Account: ${accountName}`;
      }
    }

    // ── CALL CLAUDE FOR EXTRACTION ────────────────────────
    const extractionMessage = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 1200,
      system: `You are an intelligence extraction engine for a sales professional's CRM.
Your job is to read raw sales content and extract structured signals.
Return ONLY valid JSON — no explanation, no markdown, no preamble, no code blocks.
Be specific. Extract only what is clearly present in the content.
Do not invent or assume information not present in the text.

Signal type definitions:
- champion_identified: someone inside the account is actively advocating for this deal internally, vouching for you, or pushing the deal forward on their side
- timeline_mentioned: any specific date, deadline, quarter target, or urgency driver mentioned (e.g. "need this by Q3", "board meeting in June", "go-live date is Sept 1")
- budget_mentioned: specific budget numbers, approval status, fiscal year constraints, or funding confirmation discussed (e.g. "we have $200k approved", "budget cycle ends in March")
- competitor_mentioned: a competing vendor, product, or alternative solution is referenced by name or implication
- objection_raised: prospect raises a concern, pushback, hesitation, or blocker about moving forward
- positive_sentiment: prospect expresses enthusiasm, satisfaction, eagerness, or strong interest in moving forward
- negative_sentiment: prospect expresses frustration, disappointment, disinterest, or dissatisfaction
- next_step_agreed: a concrete next action is mutually agreed upon with a specific owner or timeframe
- stakeholder_mentioned: a new person is introduced into the deal — someone who needs to be involved, informed, or who has influence over the outcome
- technical_requirement: a specific technical need, integration requirement, security concern, or infrastructure constraint is discussed
- commercial_signal: pricing discussion, budget approval status, contract terms, procurement process, legal review, MSA negotiation, payment structure, or any commercial/financial topic including mentions of legal or procurement involvement
- relationship_context: personal details, rapport-building moments, or relationship dynamics worth remembering (e.g. "loves hiking", "just had a baby", "prefers async communication")
- idea_captured: an idea, suggestion, or initiative raised by the sales rep (not the prospect) worth tracking — a creative approach, strategy thought, or internal action item the rep wants to remember
- risk_identified: any threat to deal progress including competitor pressure, internal politics, org changes, loss of champion, budget cuts, or shifting priorities
- opportunity_identified: upsell, cross-sell, expansion opportunity, or growth signal — prospect mentions adjacent needs, additional teams, or future phases that could expand deal scope

Confidence scoring guide:
- 0.9-1.0: explicitly and clearly stated in the content
- 0.7-0.89: strongly implied or clearly inferred from context
- 0.5-0.69: reasonably inferred with some uncertainty
- below 0.5: do not extract — too speculative

Deal stage context: Use the deal stage (if provided) to interpret signals appropriately. An objection in Discovery is exploratory and expected. The same objection in Negotiation is a serious risk. A timeline mention in Prospect is aspirational; in Proposal it is actionable. Weight your confidence scores accordingly — signals that are routine for the current stage get standard confidence, while unexpected or stage-critical signals get elevated confidence.`,
      messages: [
        {
          role:    'user',
          content: `Extract all intelligence signals from the following sales content.

CONTENT TYPE: ${interaction.type}
CONTENT: ${interaction.raw_content}${dealContext}

Return this exact JSON structure:
{
  "signals": [
    {
      "signal_type": "one of the 15 valid signal types",
      "content": "specific one-sentence description of the signal",
      "confidence_score": 0.0-1.0
    }
  ],
  "contacts_mentioned": [
    {
      "name": "full name if clearly stated",
      "title": "title if mentioned or null",
      "context": "what was said about them"
    }
  ],
  "deal_updates": {
    "suggested_stage": "stage name if progression clearly implied or null",
    "suggested_next_action": "specific next action if clearly stated or null",
    "momentum": "positive|negative|neutral"
  }
}

Valid signal types: champion_identified, timeline_mentioned, budget_mentioned,
competitor_mentioned, objection_raised, positive_sentiment, negative_sentiment,
next_step_agreed, stakeholder_mentioned, technical_requirement, commercial_signal,
relationship_context, idea_captured, risk_identified, opportunity_identified`,
        },
      ],
    });

    // ── PARSE EXTRACTION RESULT ───────────────────────────
    const rawText = extractionMessage.content[0].type === 'text'
      ? extractionMessage.content[0].text
      : '{}';

    let extracted: {
      signals: Array<{ signal_type: string; content: string; confidence_score: number }>;
      contacts_mentioned: Array<{ name: string; title: string | null; context: string }>;
      deal_updates: {
        suggested_stage: string | null;
        suggested_next_action: string | null;
        momentum: string;
      };
    };

    try {
      // Strip any accidental markdown fences
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      extracted = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse extraction JSON:', rawText);
      await supabase
        .from('interactions')
        .update({ extraction_status: 'failed' })
        .eq('id', interactionId);
      return NextResponse.json({ error: 'Extraction parsing failed' }, { status: 500 });
    }

    // ── FETCH EXISTING SIGNALS FOR DEDUPLICATION ──────────
    let existingQuery = supabase
      .from('signals')
      .select('id, signal_type, content, created_at, is_duplicate')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (interaction.deal_id) {
      existingQuery = existingQuery.eq('deal_id', interaction.deal_id);
    }

    const { data: existingSignals } = await existingQuery;
    const existing = existingSignals ?? [];

    // ── WRITE SIGNALS ─────────────────────────────────────
    const newSignalRows = [];
    for (const sig of extracted.signals ?? []) {
      if (!VALID_SIGNAL_TYPES.includes(sig.signal_type as SignalType)) continue;

      const duplicate = existing.some(e =>
        e.signal_type === sig.signal_type &&
        isDuplicate(sig.content, e.content)
      );

      const signalRow = {
        user_id:          userId,
        deal_id:          interaction.deal_id ?? null,
        contact_id:       null as string | null,
        interaction_id:   interactionId,
        signal_type:      sig.signal_type as SignalType,
        content:          sig.content,
        confidence_score: Math.max(0, Math.min(1, sig.confidence_score ?? 0.8)),
        is_duplicate:     duplicate,
      };

      newSignalRows.push(signalRow);
    }

    if (newSignalRows.length > 0) {
      await supabase.from('signals').insert(newSignalRows);
    }

    // ── UPDATE DEAL SCORES + CONTACT SUMMARIES (PARALLEL) ──
    const updateDealScores = async () => {
      if (!interaction.deal_id) return;

      const { data: allDealSignals } = await supabase
        .from('signals')
        .select('signal_type, content, created_at, is_duplicate')
        .eq('user_id', userId)
        .eq('deal_id', interaction.deal_id)
        .order('created_at', { ascending: false });

      const allSignals = allDealSignals ?? [];

      const intel_score     = calculateIntelScore(allSignals);
      const momentum_score  = calculateMomentumScore(allSignals);
      const signal_velocity = calculateSignalVelocity(allSignals);

      const dealUpdate: Record<string, unknown> = {
        intel_score,
        momentum_score,
        signal_velocity,
        last_activity_at: new Date().toISOString(),
      };

      // Apply suggested updates if confidence is high
      if (extracted.deal_updates?.suggested_next_action) {
        dealUpdate.next_action = extracted.deal_updates.suggested_next_action;
      }

      await supabase
        .from('deals')
        .update(dealUpdate)
        .eq('id', interaction.deal_id)
        .eq('user_id', userId);
    };

    const updateContacts = async () => {
      for (const contact of extracted.contacts_mentioned ?? []) {
        if (!contact.name?.trim()) continue;

        // Search for existing contact by name
        const { data: existingContacts } = await supabase
          .from('contacts')
          .select('id, name, relationship_summary')
          .eq('user_id', userId)
          .ilike('name', `%${contact.name.trim()}%`)
          .limit(1);

        if (existingContacts && existingContacts.length > 0) {
          // Update existing contact relationship summary
          const existingContact = existingContacts[0];
          const summaryMessage = await anthropic.messages.create({
            model:      CLAUDE_MODEL,
            max_tokens: 200,
            system: `You are updating a relationship summary for a sales contact.
Write an updated 2-3 sentence relationship summary.
Be specific. Include role context and key relationship details.
Return only the summary text — no labels, no preamble, no quotes.`,
            messages: [
              {
                role:    'user',
                content: `Current summary: ${existingContact.relationship_summary ?? 'No summary yet'}
New context: ${contact.context}
Write the updated summary.`,
              },
            ],
          });

          const newSummary = summaryMessage.content[0].type === 'text'
            ? summaryMessage.content[0].text.trim()
            : existingContact.relationship_summary;

          await supabase
            .from('contacts')
            .update({
              relationship_summary: newSummary,
              last_interaction_at:  new Date().toISOString(),
            })
            .eq('id', existingContact.id);

        } else {
          // Create stub contact — only when account_id is available
          let accountId: string | null = null;
          if (interaction.deal_id) {
            const { data: deal } = await supabase
              .from('deals')
              .select('account_id')
              .eq('id', interaction.deal_id)
              .single();
            accountId = deal?.account_id ?? null;
          }

          if (accountId) {
            await supabase.from('contacts').insert({
              user_id:              userId,
              account_id:           accountId,
              name:                 contact.name.trim(),
              title:                contact.title ?? null,
              relationship_summary: `Mentioned in a capture: ${contact.context}`,
              last_interaction_at:  new Date().toISOString(),
            });
          }
        }
      }
    };

    // Run deal scoring and contact updates in parallel
    await Promise.all([
      updateDealScores(),
      updateContacts(),
    ]);

    // ── MARK COMPLETE ─────────────────────────────────────
    await supabase
      .from('interactions')
      .update({
        extraction_status: 'complete',
        extracted_at:      new Date().toISOString(),
      })
      .eq('id', interactionId);

    return NextResponse.json({
      success:        true,
      signalsWritten: newSignalRows.length,
      contactsFound:  (extracted.contacts_mentioned ?? []).length,
    });

  } catch (error) {
    console.error('Extraction error:', error);
    return NextResponse.json(
      { error: 'Extraction failed' },
      { status: 500 }
    );
  }
}
