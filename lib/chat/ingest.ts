// ── SESSION 15B: CHAT INGESTION ──────────────────────────────
// Every user message passes through capture-worthy detection.
// If worthy → create interaction → trigger extraction pipeline.
// NO separate tables. NO duplicate logic. Chat = entry point.
//
// Safe bias: if unclear, capture.

import { SupabaseClient } from '@supabase/supabase-js';
import { saveInteraction, triggerExtraction } from '@/lib/capture-utils';
import type {
  InteractionType,
  InteractionIntentType,
} from '@/lib/types';

// ── CAPTURE-WORTHY DETECTION ─────────────────────────────────
// A message is capture-worthy if it includes commitments, plans,
// time references, relationship context, or decisions.

const COMMITMENT_PATTERNS = [
  /\b(i need to|i should|i will|i'll|i must|i have to|i've got to|gotta|gonna)\b/i,
  /\b(i want to|i'm going to|i plan to)\b/i,
];

const PLAN_PATTERNS = [
  /\b(we're going to|let's|let us|planning to|we should|we need to|we will|we'll)\b/i,
  /\b(the plan is|next step is|going forward|moving forward)\b/i,
];

const TIME_PATTERNS = [
  /\b(tomorrow|next week|next month|this week|this weekend|tonight|today)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b\d{1,2}\/\d{1,2}\b/,           // dates like 4/15
  /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i,  // times like 3:00pm
  /\b(in \d+ (days?|weeks?|months?|hours?))\b/i,
];

const RELATIONSHIP_PATTERNS = [
  /\b(\w+ is the|(\w+) works at|(\w+) is from|(\w+) is our)\b/i,
  /\b(contact|point person|lead|manager|director|vp|cto|ceo|cfo)\b/i,
  /\b(my (mom|dad|wife|husband|partner|brother|sister|friend|boss|mentor))\b/i,
];

const DECISION_PATTERNS = [
  /\b(we're moving forward|decided to|going with|chose|picked|selected)\b/i,
  /\b(confirmed|locked in|agreed on|committed to|signed off)\b/i,
  /\b(not going to|dropping|cancelling|stopping|pausing)\b/i,
];

// Things that are NOT capture-worthy
const SKIP_PATTERNS = [
  /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|got it|sure|yep|yeah|nah|no|yes)\s*[.!?]*$/i,
  /^what (should|can|do|is|are|does|did|will|would|could)\b/i,    // pure questions
  /^(how|why|when|where|who|which)\b.*\?$/i,                       // question form
  /^(tell me|show me|explain|what's|what is|what are)\b/i,         // information requests
];

export interface CaptureAssessment {
  /** Whether this message should be captured */
  isCapture: boolean;
  /** Confidence: 0–1 */
  confidence: number;
  /** What type of capture this is */
  captureType: InteractionType;
  /** Intent classification for the interaction */
  intentType: InteractionIntentType;
  /** Which pattern categories matched */
  matchedCategories: string[];
}

/**
 * Assess whether a chat message is capture-worthy.
 * Safe bias: ambiguous messages default to capture.
 */
export function assessCaptureWorthy(message: string): CaptureAssessment {
  const trimmed = message.trim();

  // Skip very short messages (< 8 chars) — unlikely to be meaningful
  if (trimmed.length < 8) {
    return {
      isCapture: false,
      confidence: 0.9,
      captureType: 'note',
      intentType: 'capture',
      matchedCategories: [],
    };
  }

  // Skip conversational fluff
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isCapture: false,
        confidence: 0.85,
        captureType: 'note',
        intentType: 'question',
        matchedCategories: [],
      };
    }
  }

  const matched: string[] = [];
  let maxConfidence = 0;

  // Check each category
  for (const p of COMMITMENT_PATTERNS) {
    if (p.test(trimmed)) { matched.push('commitment'); maxConfidence = Math.max(maxConfidence, 0.9); break; }
  }
  for (const p of PLAN_PATTERNS) {
    if (p.test(trimmed)) { matched.push('plan'); maxConfidence = Math.max(maxConfidence, 0.85); break; }
  }
  for (const p of TIME_PATTERNS) {
    if (p.test(trimmed)) { matched.push('time_reference'); maxConfidence = Math.max(maxConfidence, 0.8); break; }
  }
  for (const p of RELATIONSHIP_PATTERNS) {
    if (p.test(trimmed)) { matched.push('relationship'); maxConfidence = Math.max(maxConfidence, 0.85); break; }
  }
  for (const p of DECISION_PATTERNS) {
    if (p.test(trimmed)) { matched.push('decision'); maxConfidence = Math.max(maxConfidence, 0.9); break; }
  }

  // Safe bias: if message is long enough (>30 chars) and doesn't match
  // skip patterns, capture it anyway with lower confidence
  if (matched.length === 0 && trimmed.length > 30) {
    return {
      isCapture: true,
      confidence: 0.5,
      captureType: 'note',
      intentType: 'capture',
      matchedCategories: ['length_heuristic'],
    };
  }

  if (matched.length > 0) {
    return {
      isCapture: true,
      confidence: maxConfidence,
      captureType: 'note',
      intentType: matched.includes('commitment') || matched.includes('decision')
        ? 'capture'
        : matched.includes('relationship')
          ? 'general_intel'
          : 'capture',
      matchedCategories: matched,
    };
  }

  // Default: don't capture short ambiguous messages
  return {
    isCapture: false,
    confidence: 0.6,
    captureType: 'note',
    intentType: 'capture',
    matchedCategories: [],
  };
}

// ── INGEST CHAT MESSAGE ──────────────────────────────────────
// Main entry point. Evaluates message and creates interaction if worthy.
// Returns the interaction ID if captured, null otherwise.
// ASYNC — designed to run without blocking the chat response.

export async function ingestChatMessage(
  supabase: SupabaseClient,
  message: string,
  userId: string,
  dealId?: string | null,
): Promise<{ interactionId: string; assessment: CaptureAssessment } | null> {
  const assessment = assessCaptureWorthy(message);

  if (!assessment.isCapture) {
    return null;
  }

  try {
    const result = await saveInteraction(supabase, {
      userId,
      dealId: dealId ?? null,
      type: assessment.captureType,
      rawContent: message,
      sourceSurface: 'home_chat',
      origin: 'user',
      intentType: assessment.intentType,
      routingConfidence: assessment.confidence,
      routingMetadata: {
        classifierBucket: 'chat_ingestion',
        routingPath: 'auto',
        ambiguityNotes: `Chat capture: ${assessment.matchedCategories.join(', ')}`,
      },
    });

    if (result?.id) {
      // Trigger extraction pipeline — fire and forget
      triggerExtraction(result.id, userId);
      return { interactionId: result.id, assessment };
    }
  } catch (err) {
    // Never lose user input — log but don't throw
    console.error('Chat ingestion error:', err);
  }

  return null;
}
