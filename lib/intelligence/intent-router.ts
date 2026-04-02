// ── INTENT ROUTER ────────────────────────────────────────────
// Pre-persistence decision layer. Classifies user input by intent,
// decides whether it should change system state, and selects the
// right response tone.
//
// Replaces brittle phrase filtering with a proper classification gate.
//
// Core principle — before persistence, answer 3 questions:
//   1. What kind of input is this?
//   2. Should this change system state?
//   3. How should I respond?
//
// Intent decides the lane. Personality colors the response.
//
// Lightweight heuristics only. No LLM calls. No added latency.
// Pure computation. Deterministic.

// ── TYPES ──────────────────────────────────────────────────

export type InputIntent =
  | 'task'
  | 'event'
  | 'context'
  | 'question'
  | 'reflection'
  | 'relationship_signal'
  | 'casual'
  | 'immediate_nonpersistent';

export type PersistenceMode =
  | 'task'
  | 'interaction'
  | 'update_existing'
  | 'none';

export type ResponseMode =
  | 'decisive'
  | 'light_ack'
  | 'conversational'
  | 'reflective'
  | 'playful';

export interface InputHandlingDecision {
  intentType: InputIntent;
  persistenceMode: PersistenceMode;
  responseMode: ResponseMode;
  confidence: number;
  reason: string;
}

// ── INTENT CONTEXT (optional enrichment) ───────────────────

export interface IntentContext {
  /** Source surface — chat vs bird can bias differently */
  sourceSurface?: 'home_chat' | 'deal_chat' | 'bird' | 'capture_sheet';
  /** Whether the user is currently in a deal context */
  dealId?: string | null;
  /** Recent message count in current thread (conversational signal) */
  recentMessageCount?: number;
}

// ── CLASSIFICATION CUES ────────────────────────────────────
// Lightweight heuristics. Not a giant blacklist.
// Ordered by specificity: most specific patterns first.

// ── 1. TASK CUES ───────────────────────────────────────────
// Verbs + time, explicit intent to do something

const TASK_CUES: RegExp[] = [
  /\b(i need to|i have to|i gotta|i must|i should)\b/i,
  /\b(remind me to|don'?t forget to|make sure to)\b/i,
  /\b(send|submit|finish|complete|prep for|prepare)\b.*\b(by|before|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday)\b/i,
  /^(call|email|text|message|ping|send|submit|finish|complete|review|check|follow up|schedule|book|cancel|pick up|buy|get|return|drop off|sign|file|pay|renew|update|fix|clean|prepare|prep|study|practice|write|draft|plan|organize|set up|look into|research)\s/i,
  /\b(need to|should|gotta|gonna|going to|have to)\s+\w+/i,
  /^(?:add|create|set)\s+(?:a\s+)?(?:task|reminder|todo)\b/i,
  /^todo\s*[:\-]/i,
];

// ── 2. EVENT CUES ──────────────────────────────────────────
// Time-bound happenings you attend, not complete

const EVENT_CUES: RegExp[] = [
  /\b(gym|yoga|workout|dinner|lunch|breakfast|brunch|coffee)\s+(?:at|with)\b/i,
  /\b(meeting|call|sync|standup|stand-up)\s+(?:at|with|tomorrow|today)\b/i,
  /\b(appointment|checkup|session|class|lecture|flight|concert|movie)\b/i,
  /\b(dinner|lunch|breakfast|brunch)\s+(friday|saturday|sunday|monday|tuesday|wednesday|thursday|tonight|tomorrow)\b/i,
  /^(gym|yoga|dentist|doctor)\s+(?:at|tomorrow|today|tonight)/i,
];

// ── 3. QUESTION CUES ──────────────────────────────────────
// Interrogatives and information requests

const QUESTION_CUES: RegExp[] = [
  /\?$/,
  /^(what|who|how|why|when|where|which|can|should|could|would|is|are|do|does|did|has|have)\s/i,
  /^(tell me|show me|explain|what's|what is|what are|how do|how does)\b/i,
  /^(should i|could i|would i|can i|do i)\b/i,
  /^what should\b/i,
  /^what'?s the status\b/i,
];

// ── 4. REFLECTION CUES ────────────────────────────────────
// Emotional state, feeling, ambiguity, self-assessment

const REFLECTION_CUES: RegExp[] = [
  /\b(i feel|feeling|things feel|it feels)\b/i,
  /\b(overwhelmed|behind|slipping|stressed|anxious|burned out|burnt out|exhausted)\b/i,
  /\b(getting messy|falling behind|losing track|out of control)\b/i,
  /\b(not sure|uncertain|confused|torn|conflicted)\b/i,
  /\b(frustrated|stuck|lost|struggling)\b/i,
  /\b(i don'?t know what to)\b/i,
  /\b(this is getting|things are getting)\b/i,
];

// ── 5. RELATIONSHIP SIGNAL CUES ───────────────────────────
// Person/entity mention + opinion/signal/context

const RELATIONSHIP_CUES: RegExp[] = [
  /\b(\w+)\s+(is the|works at|is from|is our|is my|is a)\b/i,
  /\b(\w+)\s+(hasn'?t replied|hasn'?t responded|went silent|ghosted|no response)\b/i,
  /\b(\w+)\s+(seems|sounded|appeared|looked|felt)\s+(interested|hesitant|excited|worried|cold|warm|engaged|disengaged)\b/i,
  /\b(\w+)\s+(is leaning|prefers|wants|likes|doesn'?t like|hates)\b/i,
  /\b(\w+)\s+(is the .+ contact|is the point person|is the lead)\b/i,
  /\b(my (?:mom|dad|wife|husband|partner|boss|mentor))\s+(said|thinks|wants|needs)\b/i,
];

// ── 6. CONTEXT CUES ───────────────────────────────────────
// Factual updates about entities, situations, decisions

const CONTEXT_CUES: RegExp[] = [
  /\b(\w+)\s+(wants|needs|is looking for|asked for|requested)\b/i,
  /\b(the plan is|we decided|we'?re going with|going forward)\b/i,
  /\b(turns out|apparently|found out|realized|learned that)\b/i,
  /\b(\w+)\s+(is using|switched to|moved to|migrated to)\b/i,
  /\b(new deal|new opportunity|new prospect|inbound from)\b/i,
  /\b(they said|the client|the customer|the team)\b/i,
  /\b(confirmed|locked in|agreed on|committed to|signed off)\b/i,
];

// ── 7. CASUAL CUES ────────────────────────────────────────
// Low-signal conversational filler

const CASUAL_PATTERNS: RegExp[] = [
  /^(lol|haha|ha|lmao|rofl|heh)$/i,
  /^(that was funny|that'?s funny|nice one)$/i,
  /^(okay|ok|sure|yep|yeah|yea|nah|nope|cool|nice|sweet|dope|bet|word|true|facts|right|alright|aight|k)$/i,
  /^(thanks|thank you|thx|ty|cheers|appreciate it)$/i,
  /^(hi|hello|hey|yo|sup|g'?morning|good morning|good evening|good night|gn)$/i,
  /^(same|mood|relatable|literally|fr|for real|deadass)$/i,
  /^(got it|sounds good|makes sense|understood|copy|roger|noted)$/i,
];

// ── 8. IMMEDIATE NON-PERSISTENT CUES ──────────────────────
// Bodily needs, immediate physical actions, zero future relevance

const IMMEDIATE_NONPERSISTENT_CUES: RegExp[] = [
  /\b(need to poop|gotta poop|going to the bathroom|bathroom break|taking a piss|need to pee|gotta pee|using the restroom|hitting the head)\b/i,
  /^(brb|be right back|one sec|one moment|hold on|gimme a sec|gimme a minute)$/i,
  /\b(grabbing water|getting water|getting coffee|refilling|stepping out for a sec|stepping away)\b/i,
  /\b(bathroom|restroom|washroom|toilet)\b/i,
  /^(afk|away)$/i,
];

// ── MAIN ROUTER ────────────────────────────────────────────
// Runs through classification in priority order.
// First strong match wins. Ambiguous inputs fall to sensible defaults.
//
// Priority:
//   1. immediate_nonpersistent (cheapest to detect, zero persistence)
//   2. casual (common, zero persistence)
//   3. question (frequent, usually no persistence)
//   4. task (actionable, high-value persistence)
//   5. event (actionable, high-value persistence)
//   6. reflection (meaningful, optional persistence)
//   7. relationship_signal (contextual, persist as interaction)
//   8. context (enrichment, persist as interaction)
//   9. fallback

export function routeInputIntent(
  input: string,
  context?: IntentContext,
): InputHandlingDecision {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // ── GUARD: Empty or near-empty ───────────────────────────
  if (trimmed.length === 0) {
    return {
      intentType: 'casual',
      persistenceMode: 'none',
      responseMode: 'light_ack',
      confidence: 1.0,
      reason: 'Empty input',
    };
  }

  // ── 1. IMMEDIATE NON-PERSISTENT ──────────────────────────
  for (const pattern of IMMEDIATE_NONPERSISTENT_CUES) {
    if (pattern.test(lower)) {
      return {
        intentType: 'immediate_nonpersistent',
        persistenceMode: 'none',
        responseMode: 'playful',
        confidence: 0.95,
        reason: 'Immediate physical action — zero future relevance',
      };
    }
  }

  // ── 2. CASUAL ────────────────────────────────────────────
  for (const pattern of CASUAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intentType: 'casual',
        persistenceMode: 'none',
        responseMode: 'conversational',
        confidence: 0.9,
        reason: 'Conversational filler — no actionable content',
      };
    }
  }

  // ── 3. QUESTION ──────────────────────────────────────────
  for (const pattern of QUESTION_CUES) {
    if (pattern.test(trimmed)) {
      return {
        intentType: 'question',
        persistenceMode: 'none',
        responseMode: 'decisive',
        confidence: 0.85,
        reason: 'Question — answer directly, no storage needed',
      };
    }
  }

  // ── 4. TASK ──────────────────────────────────────────────
  // Check for strong task signals
  let taskScore = 0;
  for (const pattern of TASK_CUES) {
    if (pattern.test(trimmed)) {
      taskScore++;
    }
  }

  // ── 5. EVENT ─────────────────────────────────────────────
  let eventScore = 0;
  for (const pattern of EVENT_CUES) {
    if (pattern.test(trimmed)) {
      eventScore++;
    }
  }

  // ── 6. REFLECTION ────────────────────────────────────────
  let reflectionScore = 0;
  for (const pattern of REFLECTION_CUES) {
    if (pattern.test(trimmed)) {
      reflectionScore++;
    }
  }

  // ── 7. RELATIONSHIP SIGNAL ───────────────────────────────
  let relationshipScore = 0;
  for (const pattern of RELATIONSHIP_CUES) {
    if (pattern.test(trimmed)) {
      relationshipScore++;
    }
  }

  // ── 8. CONTEXT ───────────────────────────────────────────
  let contextScore = 0;
  for (const pattern of CONTEXT_CUES) {
    if (pattern.test(trimmed)) {
      contextScore++;
    }
  }

  // ── RESOLVE: Pick highest-signal intent ──────────────────
  // Task and event are highest-value actions
  // Ties broken by priority: task > event > relationship > context > reflection

  const scores: Array<{ intent: InputIntent; score: number }> = [
    { intent: 'task', score: taskScore },
    { intent: 'event', score: eventScore },
    { intent: 'relationship_signal', score: relationshipScore },
    { intent: 'context', score: contextScore },
    { intent: 'reflection', score: reflectionScore },
  ];

  // Sort by score descending, stable order for ties
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];

  if (top.score > 0) {
    return buildDecision(top.intent, top.score, trimmed, context);
  }

  // ── FALLBACK ─────────────────────────────────────────────
  // No strong signal. Use length and source to decide.
  return buildFallbackDecision(trimmed, context);
}

// ── DECISION BUILDERS ──────────────────────────────────────

function buildDecision(
  intent: InputIntent,
  score: number,
  input: string,
  context?: IntentContext,
): InputHandlingDecision {
  // Confidence scales with score: 1 match = 0.7, 2+ = 0.85, 3+ = 0.95
  const confidence = score >= 3 ? 0.95 : score >= 2 ? 0.85 : 0.7;

  switch (intent) {
    case 'task':
      return {
        intentType: 'task',
        persistenceMode: 'task',
        responseMode: 'decisive',
        confidence,
        reason: 'Actionable input with task signals',
      };

    case 'event':
      return {
        intentType: 'event',
        persistenceMode: 'task', // events route through task/event creation
        responseMode: 'decisive',
        confidence,
        reason: 'Time-bound event detected',
      };

    case 'reflection':
      return {
        intentType: 'reflection',
        // Persist reflections as interaction/context if substantial
        persistenceMode: input.length > 30 ? 'interaction' : 'none',
        responseMode: 'reflective',
        confidence,
        reason: 'Emotional or self-assessment input',
      };

    case 'relationship_signal':
      return {
        intentType: 'relationship_signal',
        persistenceMode: 'interaction',
        responseMode: 'decisive',
        confidence,
        reason: 'Relationship context update',
      };

    case 'context':
      return {
        intentType: 'context',
        persistenceMode: 'interaction',
        responseMode: 'decisive',
        confidence,
        reason: 'Contextual update — enriches system state',
      };

    default:
      return {
        intentType: intent,
        persistenceMode: 'none',
        responseMode: 'conversational',
        confidence: 0.5,
        reason: 'Unhandled intent bucket',
      };
  }
}

function buildFallbackDecision(
  input: string,
  context?: IntentContext,
): InputHandlingDecision {
  // Bird surface biases toward capture (but not blind capture)
  const isBird = context?.sourceSurface === 'bird' || context?.sourceSurface === 'capture_sheet';

  // Meaningful ambiguous inputs (>40 chars) — prefer context persistence
  if (input.length > 40) {
    return {
      intentType: 'context',
      persistenceMode: isBird ? 'interaction' : 'interaction',
      responseMode: 'decisive',
      confidence: 0.5,
      reason: 'Ambiguous but substantial — captured as context',
    };
  }

  // Short ambiguous inputs — prefer no persistence
  if (input.length > 15) {
    return {
      intentType: isBird ? 'context' : 'casual',
      persistenceMode: isBird ? 'interaction' : 'none',
      responseMode: isBird ? 'light_ack' : 'conversational',
      confidence: 0.4,
      reason: isBird
        ? 'Short input on capture surface — captured with low confidence'
        : 'Short ambiguous input — not persisted',
    };
  }

  // Very short (<= 15 chars) — almost certainly trivial
  return {
    intentType: 'casual',
    persistenceMode: 'none',
    responseMode: 'light_ack',
    confidence: 0.6,
    reason: 'Very short input — likely trivial',
  };
}
