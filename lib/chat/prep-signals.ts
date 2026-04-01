// ── SESSION 15C.1: PREP SIGNAL HANDLING ─────────────────────
// Detect phrases like:
// - "need to prep"
// - "should prepare"
// - "upcoming call"
//
// If a meeting/event exists → generate prep action.
// If context exists → include specifics.

import type { MeetingRow } from '@/lib/types';

// ── PREP INTENT PATTERNS ─────────────────────────────────────

const PREP_PATTERNS = [
  /\b(need to prep|should prep|gotta prep|have to prep)\b/i,
  /\b(need to prepare|should prepare|gotta prepare|have to prepare)\b/i,
  /\b(prep for|prepare for|get ready for)\b/i,
  /\b(upcoming call|upcoming meeting|upcoming presentation)\b/i,
  /\b(before the (call|meeting|demo|presentation|pitch))\b/i,
  /\b(prepping for|preparing for|getting ready for)\b/i,
];

export interface PrepSignal {
  /** Whether prep intent was detected */
  detected: boolean;
  /** Extracted event/meeting reference text */
  eventReference: string | null;
  /** Matched meeting if found */
  matchedMeeting: MeetingRow | null;
  /** Generated prep task title */
  prepTaskTitle: string | null;
}

/**
 * Detect prep intent in user message and match to upcoming meetings.
 */
export function detectPrepSignal(
  message: string,
  upcomingMeetings: MeetingRow[],
): PrepSignal {
  const trimmed = message.trim();

  // Check if message contains prep intent
  let hasPrepIntent = false;
  for (const pattern of PREP_PATTERNS) {
    if (pattern.test(trimmed)) {
      hasPrepIntent = true;
      break;
    }
  }

  if (!hasPrepIntent) {
    return {
      detected: false,
      eventReference: null,
      matchedMeeting: null,
      prepTaskTitle: null,
    };
  }

  // Extract the event/meeting reference
  const eventRef = extractEventReference(trimmed);

  // Try to match to an upcoming meeting
  const matchedMeeting = eventRef
    ? findMatchingMeeting(eventRef, upcomingMeetings)
    : findNextUpcomingMeeting(upcomingMeetings);

  // Generate prep task title
  const prepTaskTitle = matchedMeeting
    ? `Prep for ${matchedMeeting.title}`
    : eventRef
      ? `Prep for ${eventRef}`
      : 'Prepare for upcoming meeting';

  return {
    detected: true,
    eventReference: eventRef,
    matchedMeeting,
    prepTaskTitle,
  };
}

// ── INTERNAL ─────────────────────────────────────────────────

/**
 * Extract the event/meeting name from a prep message.
 * e.g. "need to prep for Burst Cloud call" → "Burst Cloud call"
 */
function extractEventReference(text: string): string | null {
  const patterns = [
    /(?:prep|prepare|get ready)\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:tomorrow|today|tonight|this|next)\b.*)?$/i,
    /(?:upcoming|before the)\s+(.+?)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const ref = match[1].trim()
        .replace(/\s*(tomorrow|today|tonight|this week|next week)$/i, '')
        .trim();
      if (ref.length >= 3 && ref.length <= 80) return ref;
    }
  }

  return null;
}

/**
 * Find a meeting whose title matches the reference text.
 */
function findMatchingMeeting(
  reference: string,
  meetings: MeetingRow[],
): MeetingRow | null {
  const refLower = reference.toLowerCase();
  const refWords = refLower.split(/\s+/).filter(w => w.length >= 3);

  let bestMatch: MeetingRow | null = null;
  let bestScore = 0;

  for (const meeting of meetings) {
    const titleLower = meeting.title.toLowerCase();

    // Exact substring match
    if (titleLower.includes(refLower) || refLower.includes(titleLower)) {
      return meeting;
    }

    // Word overlap
    let wordScore = 0;
    for (const word of refWords) {
      if (titleLower.includes(word)) wordScore++;
    }

    if (wordScore > bestScore) {
      bestScore = wordScore;
      bestMatch = meeting;
    }
  }

  // Require at least 1 word match
  return bestScore >= 1 ? bestMatch : null;
}

/**
 * If no specific reference, return the next upcoming meeting.
 */
function findNextUpcomingMeeting(meetings: MeetingRow[]): MeetingRow | null {
  const now = Date.now();
  const upcoming = meetings
    .filter(m => new Date(m.scheduled_at).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return upcoming[0] ?? null;
}
