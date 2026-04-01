// ── SESSION 15A+15C: ACTION NORMALIZATION ─────────────────────
// Every action must:
//   → start with a verb
//   → be <= 6 words ideally
//   → have a specific target
//
// Bad:  "maybe follow up with Monica"
// Good: "Follow up with Monica"
//
// Pure string transformation. No side effects.

// ── VERB EXTRACTION ────────────────────────────────────────

const STRONG_VERBS = new Set([
  'confirm', 'send', 'schedule', 'prepare', 'set', 'draft',
  'review', 'call', 'email', 'follow', 'define', 'lock',
  'book', 'block', 'post', 'submit', 'share', 'update',
  'create', 'finish', 'complete', 'resolve', 'close',
  'align', 'notify', 'escalate', 'start', 'cancel',
  'move', 'assign', 'ship', 'launch', 'deploy', 'test',
  'check', 'verify', 'approve', 'reject', 'accept',
  'open', 'ping', 'reach', 'meet', 'invite', 'log',
  'capture', 'document', 'record', 'file', 'transfer',
  'buy', 'order', 'pay', 'renew', 'upgrade', 'fix',
  'clean', 'organize', 'sort', 'pack', 'pick', 'drop',
  'handle', 'address', 'tackle', 'run', 'execute', 'deliver',
]);

// Words that indicate weak/passive phrasing — strip them
const WEAK_PREFIXES = /^(maybe|might|could|possibly|perhaps|try to|think about|consider|you may want to|it might help to|we should|i should|i need to|need to|should|want to|going to|gonna|have to|got to|gotta|planning to|plan to|hoping to|looking to)\s+/i;

// Filler words at the start
const FILLER_PREFIXES = /^(so|okay|um|uh|like|well|yeah|just|also|then|and|but|hey|btw|fyi)\s+/i;

// ── MAIN: NORMALIZE TO ACTION ──────────────────────────────

export function toAction(text: string): string {
  let action = text.trim();

  // Strip filler prefixes
  let iterations = 0;
  while (FILLER_PREFIXES.test(action) && iterations < 5) {
    action = action.replace(FILLER_PREFIXES, '').trim();
    iterations++;
  }

  // Strip weak/passive prefixes
  iterations = 0;
  while (WEAK_PREFIXES.test(action) && iterations < 5) {
    action = action.replace(WEAK_PREFIXES, '').trim();
    iterations++;
  }

  // If the result doesn't start with a known verb, try to add one
  const firstWord = action.split(/\s+/)[0]?.toLowerCase() ?? '';

  if (!STRONG_VERBS.has(firstWord)) {
    // Try to infer a verb from the content
    const verb = inferVerb(action);
    if (verb) {
      action = `${verb} ${action}`;
    }
  }

  // Capitalize first letter
  if (action.length > 0) {
    action = action.charAt(0).toUpperCase() + action.slice(1);
  }

  // Enforce max ~8 words for readability (soft limit)
  const words = action.split(/\s+/);
  if (words.length > 8) {
    action = words.slice(0, 8).join(' ');
  }

  // Session 15C: Hard quality rules
  // Rule: must start with strong verb — if not, reject filler verbs
  const finalFirstWord = action.split(/\s+/)[0]?.toLowerCase() ?? '';
  const FILLER_VERBS = new Set(['review', 'consider', 'think', 'check']);
  const actionWordCount = action.split(/\s+/).length;

  // If filler verb with no target (<=2 words), upgrade the verb
  if (FILLER_VERBS.has(finalFirstWord) && actionWordCount <= 2) {
    const VERB_UPGRADES: Record<string, string> = {
      'review': 'Assess',
      'consider': 'Decide',
      'think': 'Define',
      'check': 'Verify',
    };
    const upgrade = VERB_UPGRADES[finalFirstWord];
    if (upgrade) {
      action = upgrade + action.slice(finalFirstWord.length);
    }
  }

  return action;
}

// ── VERB INFERENCE ─────────────────────────────────────────
// When the input doesn't start with a verb, infer the right one.

function inferVerb(text: string): string | null {
  const lower = text.toLowerCase();

  // Person patterns → likely "Contact" or "Reach out to"
  if (/^[A-Z][a-z]+\b/.test(text) && text.split(/\s+/).length <= 3) {
    return 'Contact';
  }

  // Time patterns → "Schedule"
  if (/\b(tomorrow|today|at \d|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) {
    return 'Schedule';
  }

  // Document patterns → "Review"
  if (/\b(doc|document|file|report|pdf|deck|presentation|slides)\b/i.test(lower)) {
    return 'Review';
  }

  // Email/message patterns → "Send"
  if (/\b(email|message|note|text|slack|response|reply)\b/i.test(lower)) {
    return 'Send';
  }

  // Meeting patterns → "Confirm"
  if (/\b(meeting|call|sync|standup|check-in)\b/i.test(lower)) {
    return 'Confirm';
  }

  return null;
}

// ── BATCH NORMALIZE ────────────────────────────────────────
// Normalize multiple items and deduplicate.

export function normalizeActions(texts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const text of texts) {
    const normalized = toAction(text);
    const key = normalized.toLowerCase();
    if (!seen.has(key) && normalized.length > 0) {
      seen.add(key);
      result.push(normalized);
    }
  }

  // Session 15C: Sort by action quality — prefer specific, verb-strong actions
  result.sort((a, b) => {
    const aWords = a.split(/\s+/).length;
    const bWords = b.split(/\s+/).length;
    // Prefer 3-8 word actions (ideal range)
    const aIdeal = aWords >= 3 && aWords <= 8 ? 1 : 0;
    const bIdeal = bWords >= 3 && bWords <= 8 ? 1 : 0;
    if (aIdeal !== bIdeal) return bIdeal - aIdeal;
    // Prefer actions with more specificity (more words, up to 8)
    return Math.min(bWords, 8) - Math.min(aWords, 8);
  });

  return result.slice(0, 3);
}
