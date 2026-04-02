// ── SESSION 11F: UNIVERSAL ROUTING + CLASSIFICATION ─────────
// Routes natural-language inputs into universal primitives:
// tasks, items, people, events.
//
// Additive — does NOT replace existing sales classification.
// Activates when input is NOT strongly sales-shaped.
//
// Conservative: prefers missing over wrong.
// Correctness > aggressive automation.

import { detectTaskIntent, type TaskIntent } from '@/lib/task-intent';
import { parseTaskTime } from '@/lib/task-time-parser';

// ── UNIVERSAL INTENT TYPES ──────────────────────────────────

export type UniversalIntentKind =
  | 'create_task'
  | 'create_item'
  | 'create_event'
  | 'create_person_note';

export interface PersonReference {
  /** Resolved name (e.g. "Sarah", "mom") */
  name: string;
  /** Relational noun if detected (e.g. "mom", "professor") */
  relationship: string | null;
}

export interface UniversalRoutingResult {
  /** Primary intent detected */
  intent: UniversalIntentKind;
  /** Task details if applicable */
  task: {
    title: string;
    dueAt: string | null;
    rawTimePart: string | null;
  } | null;
  /** Item details if applicable */
  item: {
    name: string;
  } | null;
  /** Event details if applicable */
  event: {
    title: string;
    scheduledAt: string | null;
    eventType: 'event' | 'reminder' | 'deadline';
  } | null;
  /** Person reference if detected */
  person: PersonReference | null;
  /** Links to create between entities */
  links: {
    taskToItem: boolean;
    taskToPerson: boolean;
    eventToPerson: boolean;
  };
}

// ── SALES DETECTION (GUARD) ─────────────────────────────────
// If input is clearly sales-shaped, universal routing should NOT activate.

const SALES_SIGNALS: RegExp[] = [
  /(?:new deal|new opportunity|new prospect|new lead)/i,
  /(?:inbound from|referred to me|got a lead)/i,
  /(?:pipeline|deal stage|close date|proposal sent)/i,
  /(?:meeting went|call went|demo went|presentation went)/i,
  /(?:just got off|debrief|after the call)/i,
  /(?:draft an email|write an email|compose|follow up email)/i,
  /(?:they said|the client said|the customer)/i,
  /(?:champion|stakeholder|decision maker|budget holder)/i,
];

export function isSalesSignal(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return SALES_SIGNALS.some(pattern => pattern.test(lower));
}

// ── ITEM INTENT DETECTION ───────────────────────────────────
// Detects ongoing projects / areas of focus / durable contexts.

const ITEM_PATTERNS: RegExp[] = [
  /^(?:starting|beginning|kicking off|launching)\s+(?:a\s+)?(?:new\s+)?(.+)/i,
  /^(?:working on|focused on|tackling)\s+(.+)/i,
  /^(?:i'?m\s+)?(?:planning|preparing for)\s+(.+)/i,
  /^(?:need to organize|organizing)\s+(.+)/i,
  /^(?:new project)\s*[:\-]?\s*(.+)/i,
  /^(?:new goal)\s*[:\-]?\s*(.+)/i,
  /^(?:new listing)\s*[:\-]?\s*(.+)/i,
  /^(?:trying to finish|need to finish)\s+(.+)/i,
];

// Items should describe something bigger than a single task
const ITEM_AMPLIFIER_WORDS = [
  'project', 'move', 'renovation', 'launch', 'campaign',
  'prep', 'preparation', 'planning', 'initiative', 'migration',
  'redesign', 'overhaul', 'transition', 'setup', 'build',
  'course', 'exam', 'semester', 'training', 'certification',
  'goal', 'thesis', 'assignment', 'listing', 'event planning',
  'workstream', 'engagement', 'case', 'application', 'portfolio',
];

export interface ItemIntent {
  name: string;
}

export function detectItemIntent(text: string): ItemIntent | null {
  const trimmed = text.trim();
  if (trimmed.length < 6 || trimmed.length > 200) return null;

  // Check for item patterns
  for (const pattern of ITEM_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const name = cleanItemName(match[1].trim());
      if (name.length >= 3) {
        return { name };
      }
    }
  }

  // Check for amplifier words in short phrases (without explicit pattern)
  const lower = trimmed.toLowerCase();
  if (trimmed.length <= 80) {
    for (const word of ITEM_AMPLIFIER_WORDS) {
      if (lower.includes(word)) {
        // But only if it's not clearly a task (imperative verb at start)
        if (!/^(?:finish|complete|submit|review|check|do|start|begin)\s/i.test(trimmed)) {
          return { name: cleanItemName(trimmed) };
        }
      }
    }
  }

  return null;
}

function cleanItemName(raw: string): string {
  // Remove trailing time phrases
  let name = raw.replace(
    /\s+(?:today|tonight|tomorrow|this\s+(?:morning|afternoon|evening)|(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i,
    ''
  ).trim();
  // Capitalize first letter
  if (name.length > 0) {
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }
  return name;
}

// ── PERSON DETECTION ────────────────────────────────────────
// Extracts named or relational person references.

const RELATIONAL_NOUNS: Record<string, string> = {
  'mom': 'mother',
  'mum': 'mother',
  'mother': 'mother',
  'dad': 'father',
  'father': 'father',
  'brother': 'brother',
  'sister': 'sister',
  'wife': 'spouse',
  'husband': 'spouse',
  'partner': 'partner',
  'boyfriend': 'partner',
  'girlfriend': 'partner',
  'professor': 'professor',
  'teacher': 'teacher',
  'boss': 'manager',
  'manager': 'manager',
  'supervisor': 'manager',
  'doctor': 'doctor',
  'dentist': 'dentist',
  'therapist': 'therapist',
  'coach': 'coach',
  'mentor': 'mentor',
  'friend': 'friend',
  'roommate': 'roommate',
  'landlord': 'landlord',
  'client': 'client',
  'coworker': 'coworker',
  'colleague': 'colleague',
};

// Patterns that extract a person reference
const PERSON_PATTERNS: RegExp[] = [
  // "call my mom", "text my brother", "follow up with my professor"
  /(?:call|text|message|ping|email|reach out to|follow up with|meet with|dinner with|lunch with|talk to|speak with|visit)\s+(?:my\s+)?(\w+(?:\s+\w+)?)/i,
  // "with Sarah at 7", "with Jake tomorrow"
  /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  // "Professor Kim", "Dr. Smith"
  /\b((?:Professor|Prof|Dr|Coach|Pastor)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
];

// Words that should NOT be treated as person names
const NOT_PERSON_WORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'their', 'our',
  'it', 'this', 'that', 'them', 'me', 'us',
  'up', 'out', 'off', 'on', 'in', 'at', 'to', 'for',
  'home', 'work', 'office', 'school', 'gym', 'store',
  'something', 'someone', 'anyone', 'everyone', 'nobody',
  'today', 'tomorrow', 'tonight', 'morning', 'afternoon', 'evening',
  'groceries', 'dinner', 'lunch', 'breakfast',
  'proposal', 'report', 'email', 'document', 'file',
]);

export function detectPerson(text: string): PersonReference | null {
  const trimmed = text.trim();
  if (trimmed.length < 4) return null;

  // First check for relational nouns: "my mom", "my professor"
  const relationalMatch = trimmed.match(/\bmy\s+(\w+)\b/i);
  if (relationalMatch) {
    const noun = relationalMatch[1].toLowerCase();
    if (RELATIONAL_NOUNS[noun]) {
      return {
        name: noun.charAt(0).toUpperCase() + noun.slice(1),
        relationship: RELATIONAL_NOUNS[noun],
      };
    }
  }

  // Then check person patterns
  for (const pattern of PERSON_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const candidateLower = candidate.toLowerCase();

      // Skip if it's a common non-person word
      if (NOT_PERSON_WORDS.has(candidateLower)) continue;

      // Check if it's a relational noun
      if (RELATIONAL_NOUNS[candidateLower]) {
        return {
          name: candidate.charAt(0).toUpperCase() + candidate.slice(1),
          relationship: RELATIONAL_NOUNS[candidateLower],
        };
      }

      // Check if it looks like a proper name (starts with uppercase)
      // Only accept if the original text had it capitalized, or it's after "with"
      const isCapitalized = /^[A-Z]/.test(candidate);
      if (isCapitalized && candidate.length >= 2 && candidate.length <= 30) {
        return {
          name: candidate,
          relationship: null,
        };
      }
    }
  }

  return null;
}

// ── EVENT DETECTION ─────────────────────────────────────────
// Detects time-bound non-meeting events (gym, dinner, appointments).
// Uses event semantics vs task semantics to decide.

// Event-like nouns: things you "go to" or "attend", not things you "finish"
const EVENT_NOUNS = [
  'gym', 'yoga', 'pilates', 'crossfit', 'workout', 'run', 'swim',
  'dinner', 'lunch', 'breakfast', 'brunch', 'coffee',
  'class', 'lecture', 'seminar', 'workshop', 'lab',
  'appointment', 'checkup', 'session',
  'practice', 'rehearsal', 'game', 'match',
  'party', 'event', 'gathering', 'meetup',
  'flight', 'train', 'bus',
  'movie', 'show', 'concert', 'performance',
  'church', 'service', 'temple', 'mosque',
];

// Task-like verbs: things you "complete", not "attend"
const TASK_VERBS_FOR_EVENT_CHECK = [
  'finish', 'complete', 'submit', 'file', 'write', 'draft',
  'fix', 'clean', 'organize', 'review', 'prepare', 'study',
  'buy', 'return', 'pay', 'renew', 'sign', 'cancel',
];

export interface EventIntent {
  title: string;
  scheduledAt: string | null;
  eventType: 'event' | 'reminder' | 'deadline';
}

export function detectEventIntent(text: string): EventIntent | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 150) return null;

  const lower = trimmed.toLowerCase();

  // If it starts with a task-like verb, it's a task not an event
  for (const verb of TASK_VERBS_FOR_EVENT_CHECK) {
    if (lower.startsWith(verb + ' ')) return null;
  }

  // Check for event nouns
  let isEventLike = false;
  for (const noun of EVENT_NOUNS) {
    if (lower.includes(noun)) {
      isEventLike = true;
      break;
    }
  }

  // Also detect "doctor/dentist appointment" style
  if (/\b(?:doctor|dentist|therapist|vet)\b/i.test(lower)) {
    isEventLike = true;
  }

  // "dinner with X at Y" pattern
  if (/\b(?:dinner|lunch|breakfast|brunch|coffee)\s+with\b/i.test(lower)) {
    isEventLike = true;
  }

  if (!isEventLike) return null;

  // Extract time part using the same pattern as task-intent
  const TIME_SUFFIX =
    /\s+(?:today|tonight|tomorrow|this\s+(?:morning|afternoon|evening)|(?:at|by|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow\s+(?:at|by|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i;

  const timeMatch = trimmed.match(TIME_SUFFIX);
  let scheduledAt: string | null = null;
  let title = trimmed;

  if (timeMatch) {
    const rawTimePart = timeMatch[0].trim();
    title = trimmed.slice(0, trimmed.length - timeMatch[0].length).trim();
    scheduledAt = parseTaskTime(rawTimePart);
  }

  // Capitalize title
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return {
    title,
    scheduledAt,
    eventType: 'event',
  };
}

// ── MAIN UNIVERSAL ROUTER ───────────────────────────────────
// Orchestrates detection across all universal primitives.
// Returns null if no universal intent is detected (falls through to sales).
//
// Priority order:
// 1. Sales guard — if clearly sales, return null (let existing classifier handle)
// 2. Event detection — "gym at 6", "dinner with Sarah at 7"
// 3. Item detection — "starting a new project"
// 4. Task detection — "call my mom tomorrow" (already exists, enhanced with linking)
// 5. Person detection runs alongside all of the above
//
// Conservative: returns null when ambiguous.

export function routeUniversalIntent(text: string): UniversalRoutingResult | null {
  const trimmed = text.trim();

  // ── GUARD: Sales-shaped inputs bypass universal routing ────
  if (isSalesSignal(trimmed)) {
    return null;
  }

  // ── GUARD: Questions bypass universal routing ─────────────
  if (/^(what|who|how|why|when|where|which|can|should|could|would|is|are|do|does|tell me|summarize|give me|show me)\b/i.test(trimmed.toLowerCase())) {
    return null;
  }
  if (trimmed.endsWith('?')) return null;

  // ── Person detection (runs for all intents) ───────────────
  const person = detectPerson(trimmed);

  // ── Event detection (highest priority for time-bound things) ─
  const eventIntent = detectEventIntent(trimmed);
  if (eventIntent) {
    return {
      intent: 'create_event',
      task: null,
      item: null,
      event: eventIntent,
      person,
      links: {
        taskToItem: false,
        taskToPerson: false,
        eventToPerson: person !== null,
      },
    };
  }

  // ── Item detection (projects / ongoing focus areas) ────────
  const itemIntent = detectItemIntent(trimmed);

  // ── Task detection (uses existing task-intent.ts) ──────────
  const taskIntent = detectTaskIntent(trimmed);

  // If both item and task detected, create both with link
  if (itemIntent && taskIntent) {
    const dueAt = taskIntent.rawTimePart
      ? parseTaskTime(taskIntent.rawTimePart)
      : null;

    return {
      intent: 'create_task', // primary intent is task
      task: {
        title: taskIntent.title,
        dueAt,
        rawTimePart: taskIntent.rawTimePart,
      },
      item: itemIntent,
      event: null,
      person,
      links: {
        taskToItem: true,
        taskToPerson: person !== null,
        eventToPerson: false,
      },
    };
  }

  // Item only (no task)
  if (itemIntent) {
    return {
      intent: 'create_item',
      task: null,
      item: itemIntent,
      event: null,
      person,
      links: {
        taskToItem: false,
        taskToPerson: false,
        eventToPerson: false,
      },
    };
  }

  // Task only
  if (taskIntent) {
    const dueAt = taskIntent.rawTimePart
      ? parseTaskTime(taskIntent.rawTimePart)
      : null;

    return {
      intent: 'create_task',
      task: {
        title: taskIntent.title,
        dueAt,
        rawTimePart: taskIntent.rawTimePart,
      },
      item: null,
      event: null,
      person,
      links: {
        taskToItem: false,
        taskToPerson: person !== null,
        eventToPerson: false,
      },
    };
  }

  // Person-only detection is too weak to act on alone
  // Fall through to existing classification
  return null;
}
