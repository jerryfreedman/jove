// ── SESSION 7: CHAT → STATE MUTATION LAYER ───────────────────
// Parses natural language chat input to detect meeting mutations.
// Matches fuzzy targets to meetings. Applies mutations to the store.

import type {
  Meeting,
  MeetingMutation,
  MeetingMutationResult,
} from './meeting-types';
import { useMeetingStore } from './meeting-store';

// ── INTENT DETECTION ─────────────────────────────────────────

const CANCEL_PATTERNS = [
  /\b(?:cancel+ed|cancel+ing|cancel)\b/i,
  /\b(?:call|meeting|sync)\b.*\b(?:is off|got called off|won't happen|not happening|fell through)\b/i,
  /\bgot\s+cancel/i,
  /\bcall\s+is\s+off\b/i,
  /\bnot\s+(?:meeting|happening)\b/i,
];

const COMPLETE_PATTERNS = [
  /\bjust\s+finished\b/i,
  /\bthat(?:'s|s)\s+done\b/i,
  /\bjust\s+(?:got\s+off|ended|wrapped|wrapped\s+up)\b/i,
  /\bmeeting\s+(?:is\s+)?(?:done|over|finished|wrapped)\b/i,
  /\bcall\s+(?:is\s+)?(?:done|over|finished|wrapped)\b/i,
  /\bcompleted\s+(?:the\s+)?(?:meeting|call)\b/i,
];

const MOVE_PATTERNS = [
  /\b(?:moved?|rescheduled?|pushed|shifted)\s+to\b/i,
  /\b(?:moved?|rescheduled?|pushed|shifted)\s+(?:it\s+)?to\b/i,
  /\bnow\s+at\b/i,
  /\bchanged?\s+to\b/i,
];

// ── TIME PARSING (simple) ────────────────────────────────────

function parseTimeFromText(text: string): number | null {
  const lower = text.toLowerCase();

  // "tomorrow" or "tomorrow at Xpm"
  const tomorrowMatch = lower.match(/tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (tomorrowMatch) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (tomorrowMatch[1]) {
      let h = parseInt(tomorrowMatch[1], 10);
      const m = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
      const ampm = tomorrowMatch[3]?.toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0); // default to 9am
    }
    return d.getTime();
  }

  // "Xpm" or "X:XX pm" or "X:XX" standalone
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    // If time is already past, assume tomorrow
    if (d.getTime() < Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }

  return null;
}

// ── DETECT MUTATION INTENT ───────────────────────────────────

export function detectMeetingMutation(text: string): MeetingMutation | null {
  const trimmed = text.trim();

  // Check cancel first
  for (const pattern of CANCEL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        type: 'cancel',
        target: trimmed,
      };
    }
  }

  // Check complete
  for (const pattern of COMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        type: 'complete',
        target: trimmed,
      };
    }
  }

  // Check move
  for (const pattern of MOVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const newTime = parseTimeFromText(trimmed);
      return {
        type: 'move',
        target: trimmed,
        newTime: newTime ?? undefined,
      };
    }
  }

  return null;
}

// ── MATCHING ENGINE ──────────────────────────────────────────
// Given a target string, find the best matching meeting.

function normalize(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'").replace(/[""]/g, '"').trim();
}

interface MatchScore {
  meeting: Meeting;
  score: number;
}

export function matchMeeting(
  target: string,
  meetings: Meeting[],
): Meeting | null {
  if (meetings.length === 0) return null;

  const lower = normalize(target);
  const now = Date.now();
  const candidates: MatchScore[] = [];

  for (const meeting of meetings) {
    let score = 0;
    const titleLower = normalize(meeting.title);

    // Rule 1: Exact title match (highest priority)
    if (lower.includes(titleLower) || titleLower.includes(lower)) {
      score += 20;
    }

    // Rule 2: Includes match — significant words of title in text
    const titleWords = titleLower.split(/\s+/).filter(w => w.length >= 3);
    for (const word of titleWords) {
      if (lower.includes(word)) score += 6;
    }

    // Rule 3: Time proximity — nearest upcoming meeting
    const diff = Math.abs(meeting.startTime - now);
    if (diff < 2 * 60 * 60 * 1000) {
      // Within 2 hours
      score += 8;
    } else if (diff < 4 * 60 * 60 * 1000) {
      // Within 4 hours
      score += 4;
    } else if (diff < 24 * 60 * 60 * 1000) {
      // Within 24 hours
      score += 2;
    }

    // Boost scheduled meetings (more likely to be mutated)
    if (meeting.status === 'scheduled') {
      score += 3;
    }

    if (score > 0) {
      candidates.push({ meeting, score });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    return candidates[0].meeting;
  }

  // Rule 4: Fallback — most recent/upcoming meeting
  const scheduled = meetings
    .filter(m => m.status === 'scheduled')
    .sort((a, b) => Math.abs(a.startTime - now) - Math.abs(b.startTime - now));

  return scheduled[0] ?? meetings[0] ?? null;
}

// ── APPLY MUTATION ──────────────────────────────────────────

export function applyMeetingMutation(
  mutation: MeetingMutation,
): MeetingMutationResult {
  const store = useMeetingStore.getState();
  const allMeetings = store.getAll();

  const matched = matchMeeting(mutation.target, allMeetings);

  if (!matched) {
    return {
      success: false,
      meetingId: null,
      meetingTitle: null,
      mutation,
      confirmationMessage: "I couldn't find a matching meeting to update.",
    };
  }

  switch (mutation.type) {
    case 'cancel':
      store.cancelMeeting(matched.id);
      return {
        success: true,
        meetingId: matched.id,
        meetingTitle: matched.title,
        mutation,
        confirmationMessage: `Got it — I marked your ${matched.title} as cancelled.`,
      };

    case 'complete':
      store.completeMeeting(matched.id);
      return {
        success: true,
        meetingId: matched.id,
        meetingTitle: matched.title,
        mutation,
        confirmationMessage: `Noted — marked ${matched.title} as completed.`,
      };

    case 'move': {
      if (!mutation.newTime) {
        return {
          success: false,
          meetingId: matched.id,
          meetingTitle: matched.title,
          mutation,
          confirmationMessage: `I see you want to move ${matched.title}, but I couldn't parse the new time.`,
        };
      }
      store.moveMeeting(matched.id, mutation.newTime);
      const newTimeStr = new Date(mutation.newTime).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      return {
        success: true,
        meetingId: matched.id,
        meetingTitle: matched.title,
        mutation,
        confirmationMessage: `Moved your ${matched.title} to ${newTimeStr}.`,
      };
    }

    default:
      return {
        success: false,
        meetingId: null,
        meetingTitle: null,
        mutation,
        confirmationMessage: "I couldn't process that meeting update.",
      };
  }
}
