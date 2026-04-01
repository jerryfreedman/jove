// ── SESSION 11B: TASK INTENT DETECTION ─────────────────────
// Pragmatic pattern detection for user inputs that express tasks.
// NOT NLP. NOT a classifier. Just pattern matching.
//
// Returns null when intent is unclear — prefer missing over wrong.
//
// Supports:
// - explicit reminder/task intent ("remind me", "need to", "don't forget")
// - direct imperative personal tasks ("call my mom", "finish proposal")
// - simple time-bound commitments ("gym at 6", "dentist tomorrow")
//
// Does NOT overfit to sales language. General-purpose.

export interface TaskIntent {
  /** Normalized task title */
  title: string;
  /** Raw time phrase extracted, if any (for downstream parsing) */
  rawTimePart: string | null;
}

// ── EXPLICIT TASK/REMINDER PATTERNS ────────────────────────
// These are high-confidence signals that the user wants to create a task.

const EXPLICIT_TASK_PATTERNS: RegExp[] = [
  /^remind\s+me\s+to\s+(.+)/i,
  /^don'?t\s+(?:let\s+me\s+)?forget\s+to\s+(.+)/i,
  /^i\s+need\s+to\s+(.+)/i,
  /^i\s+have\s+to\s+(.+)/i,
  /^i\s+gotta\s+(.+)/i,
  /^i\s+should\s+(.+)/i,
  /^i\s+must\s+(.+)/i,
  /^make\s+sure\s+(?:i|to)\s+(.+)/i,
  /^(?:add|create|set)\s+(?:a\s+)?(?:task|reminder|todo)\s*[:\-]?\s*(.+)/i,
  /^todo\s*[:\-]?\s*(.+)/i,
];

// ── IMPERATIVE TASK PATTERNS ───────────────────────────────
// Short imperative sentences that imply personal action.
// Must be short enough to be a task, not a story.

const IMPERATIVE_VERBS = [
  'call', 'email', 'text', 'message', 'ping', 'reach out to',
  'send', 'submit', 'finish', 'complete', 'review', 'check',
  'follow up', 'follow-up', 'schedule', 'book', 'cancel',
  'pick up', 'buy', 'get', 'grab', 'return', 'drop off',
  'sign', 'file', 'pay', 'renew', 'update', 'fix', 'clean',
  'prepare', 'prep', 'study', 'practice', 'write', 'draft',
  'plan', 'organize', 'set up', 'look into', 'research',
];

// ── TIME PHRASES ───────────────────────────────────────────
// Matched at the end of the task text and stripped from the title.

const TIME_SUFFIX_PATTERN =
  /\s+(?:today|tonight|tomorrow|this\s+(?:morning|afternoon|evening)|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:at|by|before|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow\s+(?:at|by|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i;

// ── NEGATIVE PATTERNS ──────────────────────────────────────
// If any of these match, it's NOT a task — it's a question, update, or intel.

const NOT_TASK_PATTERNS: RegExp[] = [
  /^(what|who|how|why|when|where|which|can|should|could|would|is|are|do|does|did|has|have|tell me|summarize|give me|show me|explain)\b/i,
  /\?$/,
  // Deal updates / intel
  /^(they|he|she|we|the team|my team|the client|the customer)\b/i,
  // Meeting debrief language
  /(?:meeting went|call went|just got off|just finished|demo went|presentation went)/i,
  // New deal signals
  /(?:new deal|new opportunity|new prospect|new lead|inbound from)/i,
  // Email draft intent
  /(?:draft an email|write an email|compose|send an email)/i,
];

// ── MAIN DETECTION ─────────────────────────────────────────

export function detectTaskIntent(text: string): TaskIntent | null {
  const trimmed = text.trim();

  // Guard: too short or too long to be a task
  if (trimmed.length < 4 || trimmed.length > 200) return null;

  // Guard: negative patterns — these are clearly not tasks
  for (const pattern of NOT_TASK_PATTERNS) {
    if (pattern.test(trimmed)) return null;
  }

  // 1. Check explicit task/reminder patterns
  for (const pattern of EXPLICIT_TASK_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return extractTaskParts(match[1].trim());
    }
  }

  // 2. Check imperative verb patterns (short commands)
  const lower = trimmed.toLowerCase();
  for (const verb of IMPERATIVE_VERBS) {
    if (lower.startsWith(verb + ' ') || lower === verb) {
      // Only if the message is reasonably short (task-like, not a paragraph)
      if (trimmed.length <= 100) {
        return extractTaskParts(trimmed);
      }
    }
  }

  // 3. Check for bare noun + time pattern ("gym at 6", "dentist tomorrow")
  if (trimmed.length <= 60 && TIME_SUFFIX_PATTERN.test(trimmed)) {
    // Only short messages with a clear time suffix
    const words = trimmed.split(/\s+/);
    if (words.length <= 8) {
      return extractTaskParts(trimmed);
    }
  }

  return null;
}

// ── EXTRACT TITLE + TIME ───────────────────────────────────

function extractTaskParts(raw: string): TaskIntent {
  const timeMatch = raw.match(TIME_SUFFIX_PATTERN);

  if (timeMatch) {
    const timePart = timeMatch[0].trim();
    const titlePart = raw.slice(0, raw.length - timeMatch[0].length).trim();
    return {
      title: capitalizeFirst(titlePart || raw),
      rawTimePart: timePart,
    };
  }

  return {
    title: capitalizeFirst(raw),
    rawTimePart: null,
  };
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
