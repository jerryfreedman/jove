// ── SESSION 15: TASK TITLE NORMALIZATION ────────────────────
// Transforms raw user input into clean, short, verb-first task titles.
//
// Requirements:
//   → Short: ideally 3–8 words
//   → Verb-first when possible
//   → Remove excess detail / filler
//   → Preserve meaning
//   → Time/date context goes to metadata, NOT the title
//
// Examples:
//   "The call with Monica went well and I should maybe follow up with her
//    next week about POC timing" → "Follow up with Monica"
//   "Need to think about thesis direction" → "Define thesis direction"
//   "Schedule the demo for next week with team" → "Schedule demo"
//   "I gotta call my mom tomorrow morning" → "Call mom"
//   "remind me to send the proposal by Friday" → "Send proposal"

// ── CONSTANTS ─────────────────────────────────────────────────

// Strong action verbs that should lead a task title
const STRONG_VERBS = new Set([
  'call', 'email', 'text', 'send', 'submit', 'follow', 'schedule',
  'book', 'cancel', 'prepare', 'prep', 'draft', 'review', 'check',
  'confirm', 'update', 'fix', 'resolve', 'complete', 'finish',
  'set', 'define', 'align', 'notify', 'share', 'provide', 'write',
  'plan', 'organize', 'clean', 'buy', 'return', 'pay', 'renew',
  'sign', 'file', 'research', 'study', 'practice', 'reach', 'ping',
  'message', 'pick', 'drop', 'grab', 'get', 'move', 'ship',
  'launch', 'deploy', 'test', 'verify', 'approve', 'decide',
  'assign', 'handle', 'address', 'tackle', 'run', 'deliver',
  'order', 'upgrade', 'pack', 'sort', 'transfer', 'invite',
  'meet', 'visit', 'start', 'begin', 'create', 'build',
]);

// Filler/weak prefixes to strip
const STRIP_PREFIXES: RegExp[] = [
  /^(?:i\s+)?(?:need to|have to|gotta|should|must|want to|going to|gonna|planning to|plan to|hoping to|looking to|got to)\s+/i,
  /^(?:remind me to|don'?t (?:let me )?forget to|make sure (?:i|to))\s+/i,
  /^(?:maybe|might|could|possibly|perhaps|try to|think about|consider)\s+/i,
  /^(?:so|okay|um|uh|like|well|yeah|just|also|then|and|but|hey|btw|fyi)\s+/i,
  /^(?:i think i should|i feel like i should|it would be good to|it might help to|we should|you may want to)\s+/i,
  /^(?:add|create|set)\s+(?:a\s+)?(?:task|reminder|todo)\s*[:\-]?\s*/i,
  /^todo\s*[:\-]?\s*/i,
];

// Time phrases to strip from the title (they belong in due_at metadata)
const TIME_SUFFIXES: RegExp[] = [
  /\s+(?:today|tonight|tomorrow|this\s+(?:morning|afternoon|evening))\s*$/i,
  /\s+(?:next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s*$/i,
  /\s+(?:(?:at|by|before|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i,
  /\s+(?:tomorrow\s+(?:at|by|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i,
  /\s+(?:on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s*$/i,
  /\s+(?:(?:in|within)\s+\d+\s+(?:hours?|days?|weeks?))\s*$/i,
  /\s+for\s+(?:today|tomorrow|next\s+week)\s*$/i,
];

// Filler words / phrases to strip from the middle
const FILLER_PHRASES: RegExp[] = [
  /\s+about that\s*/i,
  /\s+about this\s*/i,
  /\s+about it\s*/i,
  /\s+with (?:the\s+)?team\s*$/i,
  /\s+asap\s*$/i,
  /\s+when (?:i|you|we) (?:can|get a chance)\s*$/i,
  /\s+if possible\s*$/i,
  /\s+at some point\s*$/i,
];

// Articles / determiners that can be stripped in short titles
const STRIP_ARTICLES = /\b(the|a|an)\s+/gi;

// Verb upgrades for weak/vague verbs
const VERB_UPGRADES: Record<string, string> = {
  'think': 'Define',
  'consider': 'Decide',
  'look': 'Research',
  'maybe': 'Review',
  'figure': 'Determine',
};

// ── MAIN NORMALIZER ───────────────────────────────────────────

export interface NormalizedTitle {
  /** Clean, short, verb-first title */
  title: string;
  /** Time phrase extracted (if any) — for metadata */
  extractedTimePart: string | null;
}

export function normalizeTaskTitle(rawInput: string): NormalizedTitle {
  let text = rawInput.trim();
  let extractedTimePart: string | null = null;

  // ── Step 1: Extract and remove time phrases ─────────────────
  for (const pattern of TIME_SUFFIXES) {
    const match = text.match(pattern);
    if (match) {
      extractedTimePart = match[0].trim();
      text = text.slice(0, text.length - match[0].length).trim();
      break; // Only extract one time phrase
    }
  }

  // ── Step 2: Strip filler/weak prefixes ──────────────────────
  let iterations = 0;
  let changed = true;
  while (changed && iterations < 5) {
    changed = false;
    for (const pattern of STRIP_PREFIXES) {
      const before = text;
      text = text.replace(pattern, '').trim();
      if (text !== before) changed = true;
    }
    iterations++;
  }

  // ── Step 3: Strip filler phrases from middle/end ────────────
  for (const pattern of FILLER_PHRASES) {
    text = text.replace(pattern, '').trim();
  }

  // ── Step 4: If first word isn't a strong verb, try to upgrade ─
  const firstWord = text.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!STRONG_VERBS.has(firstWord)) {
    // Check if we have a verb upgrade
    const upgrade = VERB_UPGRADES[firstWord];
    if (upgrade) {
      text = upgrade + text.slice(firstWord.length);
    } else {
      // Try to infer a verb from content
      const verb = inferTaskVerb(text);
      if (verb) {
        text = `${verb} ${text}`;
      }
    }
  }

  // ── Step 5: Strip articles for brevity ──────────────────────
  // Only strip "the" from positions after the first word
  const words = text.split(/\s+/);
  if (words.length > 3) {
    text = words[0] + ' ' + words.slice(1).join(' ').replace(STRIP_ARTICLES, '');
    text = text.replace(/\s+/g, ' ').trim();
  }

  // ── Step 6: Enforce max 8 words ─────────────────────────────
  const finalWords = text.split(/\s+/);
  if (finalWords.length > 8) {
    text = finalWords.slice(0, 8).join(' ');
  }

  // ── Step 7: Capitalize first letter ─────────────────────────
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ── Step 8: Final cleanup ───────────────────────────────────
  // Remove trailing punctuation (except for titles that are proper nouns)
  text = text.replace(/[.,;:!]+$/, '').trim();

  return {
    title: text || rawInput.trim().slice(0, 50), // Fallback to truncated original
    extractedTimePart,
  };
}

// ── VERB INFERENCE ────────────────────────────────────────────

function inferTaskVerb(text: string): string | null {
  const lower = text.toLowerCase();

  // Person patterns → "Contact"
  if (/^[A-Z][a-z]+\b/.test(text) && text.split(/\s+/).length <= 3) {
    return 'Contact';
  }

  // Document patterns → "Review"
  if (/\b(doc|document|file|report|pdf|deck|presentation|slides)\b/i.test(lower)) {
    return 'Review';
  }

  // Email/message patterns → "Send"
  if (/\b(email|message|note|text|slack|response|reply)\b/i.test(lower)) {
    return 'Send';
  }

  // Meeting patterns → "Schedule"
  if (/\b(meeting|call|sync|standup|check-in)\b/i.test(lower)) {
    return 'Schedule';
  }

  return null;
}
