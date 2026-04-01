// ── SESSION 15A: DECISION ENGINE ──────────────────────────────
// Replaces synthesis. Every output is a decision, not a summary.
//
// Core rule: if the output could have been written by the user, it failed.
// Jove must: reduce ambiguity, choose a direction, suggest action.
//
// Pure computation. No LLM calls. No storage.

import { toAction } from './action';

// ── TYPES ──────────────────────────────────────────────────

export interface DecisionOutput {
  /** Compressed context — what is this about */
  situation: string;
  /** What this actually means — Jove's interpretation */
  interpretation: string;
  /** Single direction — what should happen next */
  decision: string;
  /** 1–3 concrete steps, verb-first */
  actions: string[];
}

// ── HARD RULES ─────────────────────────────────────────────
// Forbidden words: maybe, might, consider, could, possibly
// Replace with: Set, Confirm, Schedule, Send, Prepare

const FORBIDDEN = /\b(maybe|might|consider|could|possibly|perhaps|think about)\b/gi;

const FORBIDDEN_REPLACEMENTS: Record<string, string> = {
  'maybe': 'Set',
  'might': 'Set',
  'consider': 'Prepare',
  'could': 'Set',
  'possibly': 'Set',
  'perhaps': 'Set',
  'think about': 'Prepare',
};

function enforceHardLanguage(text: string): string {
  return text.replace(FORBIDDEN, (match) => {
    return FORBIDDEN_REPLACEMENTS[match.toLowerCase()] ?? 'Set';
  });
}

// ── SITUATION COMPRESSION ──────────────────────────────────
// Extract the core context from raw input. Strip filler.

const FILLER_PATTERNS = [
  /^(so|okay|um|uh|like|well|yeah|hey|btw|fyi|just)\s+/i,
  /\b(i think|i guess|i feel like|basically|kind of|sort of|you know)\b/gi,
  /\b(we're|we are|i'm|i am)\s+(thinking|planning|going to|gonna)\b/gi,
];

function compressSituation(input: string): string {
  let text = input.trim();

  // Strip filler
  for (const pattern of FILLER_PATTERNS) {
    text = text.replace(pattern, '').trim();
  }

  // Capitalize first letter
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Truncate to ~80 chars at word boundary
  if (text.length > 80) {
    const truncated = text.slice(0, 80);
    const lastSpace = truncated.lastIndexOf(' ');
    text = (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trim();
  }

  return text;
}

// ── INTERPRETATION PATTERNS ────────────────────────────────
// Map input signals to meaning.

interface InterpretationRule {
  pattern: RegExp;
  interpret: string;
}

const INTERPRETATION_RULES: InterpretationRule[] = [
  { pattern: /\b(warehouse|visit|in[- ]person|on[- ]?site|office)\b/i, interpret: 'Opportunity to deepen relationship through in-person engagement' },
  { pattern: /\b(meet|meeting|call|sync|catch up|check[- ]in)\b/i, interpret: 'Relationship touchpoint — align on next steps' },
  { pattern: /\b(contract|proposal|sow|agreement|terms|pricing)\b/i, interpret: 'Commercial momentum — move toward commitment' },
  { pattern: /\b(demo|pilot|poc|trial|proof of concept)\b/i, interpret: 'Technical validation opportunity' },
  { pattern: /\b(follow[- ]?up|circle back|reconnect|touch base)\b/i, interpret: 'Re-engagement needed to maintain momentum' },
  { pattern: /\b(introduce|intro|connect|referral|referred)\b/i, interpret: 'Expand network through warm connection' },
  { pattern: /\b(timeline|deadline|by .+|due|urgent|asap)\b/i, interpret: 'Time-sensitive — lock commitment now' },
  { pattern: /\b(blocker|stuck|waiting|hold|delay|problem|issue)\b/i, interpret: 'Blocked — resolve to unblock progress' },
  { pattern: /\b(competitor|alternative|other vendor|shopping)\b/i, interpret: 'Competitive pressure — differentiate and accelerate' },
  { pattern: /\b(budget|funding|approved|spend|cost)\b/i, interpret: 'Financial alignment — confirm budget and path' },
  { pattern: /\b(hire|hiring|team|headcount|role)\b/i, interpret: 'Team building — define role and timeline' },
  { pattern: /\b(launch|ship|release|go[- ]?live|deploy)\b/i, interpret: 'Delivery milestone — confirm readiness' },
  { pattern: /\b(cancel|churn|leaving|switching|unhappy|frustrated)\b/i, interpret: 'Retention risk — address concerns immediately' },
  { pattern: /\b(mom|dad|family|parent|brother|sister|friend)\b/i, interpret: 'Personal commitment — schedule and protect time' },
  { pattern: /\b(gym|workout|exercise|run|health|doctor|dentist)\b/i, interpret: 'Health priority — block time' },
];

function interpretInput(input: string): string {
  const lower = input.toLowerCase();

  for (const rule of INTERPRETATION_RULES) {
    if (rule.pattern.test(lower)) {
      return rule.interpret;
    }
  }

  // Default: generic but still interpretive
  return 'New context captured — define next action';
}

// ── DECISION EXTRACTION ────────────────────────────────────
// Pick the ONE thing that should happen next.

interface DecisionRule {
  pattern: RegExp;
  decide: string;
}

const DECISION_RULES: DecisionRule[] = [
  { pattern: /\b(warehouse|visit|in[- ]person|on[- ]?site)\b/i, decide: 'Lock visit date' },
  { pattern: /\b(meeting|call|sync|catch up)\b/i, decide: 'Confirm meeting details' },
  { pattern: /\b(contract|proposal|sow|agreement)\b/i, decide: 'Send proposal' },
  { pattern: /\b(demo|pilot|poc|trial)\b/i, decide: 'Schedule demo' },
  { pattern: /\b(follow[- ]?up|circle back|reconnect)\b/i, decide: 'Send follow-up' },
  { pattern: /\b(introduce|intro|connect|referral)\b/i, decide: 'Make introduction' },
  { pattern: /\b(timeline|deadline|urgent|asap)\b/i, decide: 'Set deadline and confirm' },
  { pattern: /\b(blocker|stuck|waiting|problem|issue)\b/i, decide: 'Resolve blocker' },
  { pattern: /\b(competitor|alternative|other vendor)\b/i, decide: 'Differentiate and accelerate' },
  { pattern: /\b(budget|funding|approved|cost)\b/i, decide: 'Confirm budget' },
  { pattern: /\b(hire|hiring|team|role)\b/i, decide: 'Post role and start sourcing' },
  { pattern: /\b(launch|ship|release|deploy)\b/i, decide: 'Confirm launch date' },
  { pattern: /\b(cancel|churn|unhappy|frustrated)\b/i, decide: 'Schedule save conversation' },
  { pattern: /\b(mom|dad|family|parent|friend)\b/i, decide: 'Schedule time' },
  { pattern: /\b(gym|workout|exercise|health|doctor|dentist)\b/i, decide: 'Block time' },
  { pattern: /\b(call|phone|ring)\b/i, decide: 'Set call time' },
  { pattern: /\b(email|send|message|write)\b/i, decide: 'Draft and send' },
  { pattern: /\b(buy|purchase|order|get)\b/i, decide: 'Place order' },
  { pattern: /\b(review|read|check|look at)\b/i, decide: 'Review and respond' },
];

function extractDecision(input: string): string {
  const lower = input.toLowerCase();

  for (const rule of DECISION_RULES) {
    if (rule.pattern.test(lower)) {
      return rule.decide;
    }
  }

  return 'Define next action';
}

// ── ACTION GENERATION ──────────────────────────────────────
// Extract 1–3 concrete, verb-first actions from context.

interface ActionRule {
  pattern: RegExp;
  actions: string[];
}

const ACTION_RULES: ActionRule[] = [
  {
    pattern: /\b(warehouse|visit|in[- ]person|on[- ]?site)\b/i,
    actions: ['Confirm availability', 'Identify attendees', 'Prepare discussion agenda'],
  },
  {
    pattern: /\b(meeting|call|sync)\b/i,
    actions: ['Confirm time and attendees', 'Prepare agenda', 'Send calendar invite'],
  },
  {
    pattern: /\b(contract|proposal|sow|agreement)\b/i,
    actions: ['Draft proposal', 'Review terms', 'Send for approval'],
  },
  {
    pattern: /\b(demo|pilot|poc|trial)\b/i,
    actions: ['Schedule demo session', 'Prepare environment', 'Confirm attendees'],
  },
  {
    pattern: /\b(follow[- ]?up|circle back|reconnect)\b/i,
    actions: ['Draft follow-up message', 'Reference last conversation', 'Set response deadline'],
  },
  {
    pattern: /\b(introduce|intro|connect|referral)\b/i,
    actions: ['Draft intro email', 'Confirm both parties', 'Set context'],
  },
  {
    pattern: /\b(blocker|stuck|waiting|problem|issue)\b/i,
    actions: ['Identify root cause', 'Escalate if needed', 'Set resolution deadline'],
  },
  {
    pattern: /\b(cancel|churn|unhappy|frustrated)\b/i,
    actions: ['Schedule call immediately', 'Prepare retention offer', 'Document concerns'],
  },
  {
    pattern: /\b(hire|hiring|team|role)\b/i,
    actions: ['Write job description', 'Post role', 'Start outreach'],
  },
  {
    pattern: /\b(launch|ship|release|deploy)\b/i,
    actions: ['Confirm launch checklist', 'Notify stakeholders', 'Set go-live date'],
  },
];

function generateActions(input: string, decision: string): string[] {
  const lower = input.toLowerCase();

  for (const rule of ACTION_RULES) {
    if (rule.pattern.test(lower)) {
      return rule.actions.map(toAction);
    }
  }

  // Fallback: derive from decision
  const normalized = toAction(decision);
  return [normalized];
}

// ── ENTITY EXTRACTION (lightweight) ────────────────────────
// Pull out names for personalization.

function extractPerson(input: string): string | null {
  // "with Monica", "from Sarah", "to John"
  const match = input.match(/\b(?:with|from|to|for|and|ask|tell|ping|email|call|meet)\s+([A-Z][a-z]+)/);
  return match ? match[1] : null;
}

function extractCompany(input: string): string | null {
  // Common patterns for company names
  const match = input.match(/\b(?:at|from|with|for)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)\b/);
  if (match && match[1] && match[1].length >= 3) {
    // Exclude common non-company words
    const excluded = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
    if (!excluded.has(match[1])) return match[1];
  }
  return null;
}

// ── MAIN: DECISION FROM INPUT ──────────────────────────────

export function decideFromInput(input: string): DecisionOutput {
  const trimmed = input.trim();

  // 1. Compress situation
  let situation = compressSituation(trimmed);

  // Enrich with entity if found
  const person = extractPerson(trimmed);
  const company = extractCompany(trimmed);
  if (company && !situation.includes(company)) {
    situation = `${situation} — ${company}`;
  }

  // 2. Interpret
  const interpretation = interpretInput(trimmed);

  // 3. Decide
  let decision = extractDecision(trimmed);

  // Personalize decision with entity
  if (person) {
    decision = `${decision} with ${person}`;
  }

  // 4. Generate actions
  let actions = generateActions(trimmed, decision);

  // Personalize actions with extracted entities
  if (person) {
    actions = actions.map(a => {
      if (a.toLowerCase().includes('confirm') && !a.includes(person)) {
        return `${a} with ${person}`;
      }
      return a;
    });
  }

  // Enforce hard language everywhere
  situation = enforceHardLanguage(situation);
  decision = enforceHardLanguage(decision);
  actions = actions.map(enforceHardLanguage);

  // Max 3 actions
  actions = actions.slice(0, 3);

  return {
    situation,
    interpretation,
    decision,
    actions,
  };
}

// ── SUN DECISION SURFACE ───────────────────────────────────
// Specialized output for the Sun overlay.
// Structure: headline + insight + gap + next actions.
// Max ~5 lines. Must feel like a recommendation, not a recap.

export interface SunDecision {
  /** Decision headline — what to do */
  headline: string;
  /** Key interpretation insight */
  insight: string;
  /** Key risk or gap */
  gap: string;
  /** 1–2 next actions, verb-first */
  nextActions: string[];
}

export function decideSunOutput(
  items: Array<{ title: string; subtitle?: string; time?: string; nextAction?: string }>,
): SunDecision | null {
  if (items.length === 0) return null;

  const top = items[0];

  // Headline: action-oriented, not descriptive
  let headline: string;
  if (top.nextAction) {
    headline = toAction(top.nextAction);
  } else if (top.time === 'overdue') {
    headline = `Handle ${top.title} now`;
  } else if (top.time) {
    headline = `${toAction(top.title)} — ${top.time}`;
  } else {
    headline = toAction(top.title);
  }

  // Insight: derived from item context
  const insight = top.subtitle
    ? enforceHardLanguage(top.subtitle)
    : `${top.title} is the priority`;

  // Gap: identify what's missing or risky
  let gap: string;
  if (items.length > 2) {
    gap = `${items.length} items competing for attention`;
  } else if (top.time === 'overdue') {
    gap = 'Past due — risk of dropping';
  } else if (!top.nextAction && !top.subtitle) {
    gap = 'No next action defined';
  } else {
    gap = 'Timing is currently undefined';
  }

  // Next actions: from top 2 items
  const nextActions: string[] = [];
  for (const item of items.slice(0, 2)) {
    if (item.nextAction) {
      nextActions.push(toAction(item.nextAction));
    } else {
      nextActions.push(toAction(item.title));
    }
  }

  return {
    headline: enforceHardLanguage(headline),
    insight,
    gap,
    nextActions: nextActions.slice(0, 2),
  };
}
