// ── CHAT INTELLIGENCE ENGINE ──────────────────────────────────
// Session 3: Deterministic message classification + confidence routing.
// Session 11F: Universal routing — classify into tasks, items, people, events.
// Lightweight, client-side heuristics. No LLM calls for classification.
// Ambiguity-safe: preserves all candidates, never silently collapses.

import type { DealRow, MeetingRow } from '@/lib/types';
import { routeUniversalIntent, type UniversalRoutingResult } from '@/lib/universal-routing';

// ── CLASSIFICATION BUCKETS ────────────────────────────────────
export type MessageBucket =
  | 'existing_deal_update'
  | 'new_deal'
  | 'general_intel'
  | 'meeting_context'
  | 'email_draft'
  | 'question';

export type ConfidenceLevel = 'high' | 'low';

// ── CANDIDATE TYPES ──────────────────────────────────────────
export interface DealCandidate {
  dealId: string;
  dealName: string;
  accountName: string | null;
  score: number;
}

export interface MeetingCandidate {
  meetingId: string;
  meetingTitle: string;
  dealId: string | null;
  score: number;
}

export interface ClassificationResult {
  bucket: MessageBucket;
  confidence: ConfidenceLevel;
  matchedDealId: string | null;
  matchedDealName: string | null;
  matchedMeetingId: string | null;
  matchedMeetingTitle: string | null;
  /** If confidence is low, this holds the single clarification question */
  clarificationQuestion: string | null;
  /** For new deal detection — extracted company/opportunity name */
  extractedEntityName: string | null;
  /** All deal candidates scored at classification time (Session 3) */
  allDealCandidates: DealCandidate[];
  /** All meeting candidates scored at classification time (Session 3) */
  allMeetingCandidates: MeetingCandidate[];
  /** Why the classifier was uncertain, if applicable (Session 3) */
  ambiguityReason: string | null;
  /** Session 11F: Universal routing result (tasks, items, people, events) */
  universalRoute: UniversalRoutingResult | null;
}

type DealWithAccount = DealRow & { accounts: { name: string } | null };

// ── CONFIDENCE THRESHOLDS ────────────────────────────────────
// Score >= HIGH_CONFIDENCE_THRESHOLD → auto-link
// Score >= MIN_MATCH_THRESHOLD but < HIGH_CONFIDENCE_THRESHOLD → low confidence
// Score < MIN_MATCH_THRESHOLD → no match
const HIGH_CONFIDENCE_DEAL_THRESHOLD = 8;
const MIN_DEAL_MATCH_THRESHOLD = 3;
// If the gap between #1 and #2 deal candidates is < this, treat as ambiguous
const AMBIGUOUS_DEAL_GAP = 3;

// ── HELPERS ───────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'").replace(/[""]/g, '"').trim();
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = normalize(text);
  return keywords.some(kw => lower.includes(kw));
}

/**
 * Session 7: Detect if text contains a question component, even when the
 * primary classification is intel/update.  Used for hybrid "mixed" routing:
 * save the intel AND stream a meaningful response.
 */
export function hasQuestionIntent(text: string): boolean {
  return isQuestion(text);
}

/** Check if text is a question to the assistant */
function isQuestion(text: string): boolean {
  const lower = normalize(text);
  // Starts with question word
  if (/^(what|who|how|why|when|where|which|can|should|could|would|is|are|do|does|tell me|summarize|give me|show me)\b/.test(lower)) {
    return true;
  }
  // Ends with question mark
  if (lower.endsWith('?')) return true;
  // Advisory/assistant intent
  if (containsAny(lower, ['what should i', 'what do you think', 'any advice', 'help me think', 'biggest risk', 'summarize', 'recap', 'what\'s the status'])) {
    return true;
  }
  return false;
}

/** Check for email/draft intent */
function isEmailIntent(text: string): boolean {
  const lower = normalize(text);
  return containsAny(lower, [
    'draft an email', 'write an email', 'send an email', 'email to',
    'draft a message', 'compose', 'follow up email', 'follow-up email',
    'reply to', 'respond to their email',
  ]);
}

/** Check for new deal / new opportunity signals */
function isNewDealSignal(text: string): boolean {
  const lower = normalize(text);
  return containsAny(lower, [
    'new deal', 'new opportunity', 'new prospect', 'new lead',
    'just met', 'new account', 'got a lead', 'potential deal',
    'opening up a', 'starting a conversation with', 'new pipeline',
    'inbound from', 'referred to me',
  ]);
}

/** Check for meeting-related context */
function isMeetingContext(text: string): boolean {
  const lower = normalize(text);
  return containsAny(lower, [
    'meeting went', 'call went', 'just got off', 'just finished',
    'in the meeting', 'on the call', 'demo went', 'presentation went',
    'after the call', 'before the meeting', 'during the call',
    'meeting with', 'call with', 'spoke with', 'talked to',
    'they said in the meeting', 'debrief',
  ]);
}

// ── DEAL MATCHING (AMBIGUITY-SAFE) ──────────────────────────
// Returns ALL candidates above minimum threshold, sorted by score desc.
// The caller decides whether the top match is confident enough.

function scoreDealCandidates(
  text: string,
  deals: DealWithAccount[],
): DealCandidate[] {
  const lower = normalize(text);
  const candidates: DealCandidate[] = [];

  for (const deal of deals) {
    let score = 0;
    const dealNameLower = normalize(deal.name);
    const accountNameLower = deal.accounts ? normalize(deal.accounts.name) : null;

    // Exact deal name match (highest signal)
    if (dealNameLower.length >= 3 && lower.includes(dealNameLower)) {
      score += 10;
    }
    // Account name match
    if (accountNameLower && accountNameLower.length >= 3 && lower.includes(accountNameLower)) {
      score += 8;
    }
    // Partial match — significant words of deal name (>= 4 chars)
    const dealWords = dealNameLower.split(/\s+/).filter(w => w.length >= 4);
    for (const word of dealWords) {
      if (lower.includes(word)) score += 3;
    }
    // Partial match — significant words of account name
    if (accountNameLower) {
      const accountWords = accountNameLower.split(/\s+/).filter(w => w.length >= 4);
      for (const word of accountWords) {
        if (lower.includes(word)) score += 3;
      }
    }

    if (score >= MIN_DEAL_MATCH_THRESHOLD) {
      candidates.push({
        dealId: deal.id,
        dealName: deal.name,
        accountName: deal.accounts?.name ?? null,
        score,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/** Determine the best deal match and confidence from scored candidates */
function resolveDealMatch(candidates: DealCandidate[]): {
  bestMatch: DealCandidate | null;
  confidence: ConfidenceLevel;
  ambiguityReason: string | null;
} {
  if (candidates.length === 0) {
    return { bestMatch: null, confidence: 'low', ambiguityReason: null };
  }

  const best = candidates[0];

  // Single candidate with strong score → high confidence
  if (candidates.length === 1 && best.score >= HIGH_CONFIDENCE_DEAL_THRESHOLD) {
    return { bestMatch: best, confidence: 'high', ambiguityReason: null };
  }

  // Multiple candidates: check the gap between #1 and #2
  if (candidates.length > 1) {
    const gap = best.score - candidates[1].score;
    if (gap < AMBIGUOUS_DEAL_GAP) {
      // Too close — ambiguous
      return {
        bestMatch: null,
        confidence: 'low',
        ambiguityReason: `Multiple deals match closely: ${candidates.slice(0, 3).map(c => `${c.dealName} (${c.score})`).join(', ')}`,
      };
    }
  }

  // Clear winner — check if score is high enough for auto-link
  if (best.score >= HIGH_CONFIDENCE_DEAL_THRESHOLD) {
    return { bestMatch: best, confidence: 'high', ambiguityReason: null };
  }

  // Session 8: Score is above minimum but below high confidence threshold
  // NEVER auto-link — force clarification to prevent data pollution.
  // Better to ask than to silently attach to the wrong deal.
  return {
    bestMatch: null,
    confidence: 'low',
    ambiguityReason: `Below confidence threshold: ${best.dealName} (score ${best.score})`,
  };
}

// ── MEETING MATCHING (AMBIGUITY-SAFE) ───────────────────────
// Returns ALL candidates, never silently picks one from ambiguous set.

function scoreMeetingCandidates(
  text: string,
  meetings: MeetingRow[],
  deals?: DealWithAccount[],
): MeetingCandidate[] {
  const lower = normalize(text);
  const now = Date.now();
  const candidates: MeetingCandidate[] = [];

  // Session 8: Build account name lookup from deals for cross-referencing
  const dealAccountMap = new Map<string, string>();
  if (deals) {
    for (const deal of deals) {
      if (deal.accounts?.name) {
        dealAccountMap.set(deal.id, normalize(deal.accounts.name));
      }
    }
  }

  for (const meeting of meetings) {
    let score = 0;
    const start = new Date(meeting.scheduled_at).getTime();
    const end = start + 60 * 60 * 1000; // 1 hour assumed duration

    // Time proximity scoring
    if (now >= start && now <= end + 2 * 60 * 60 * 1000) {
      // Meeting in progress or ended < 2 hours ago → strong signal
      score += 8;
    } else if (now >= start && now <= end + 4 * 60 * 60 * 1000) {
      // Ended 2-4 hours ago → moderate signal
      score += 4;
    }

    // Title word match
    const titleLower = normalize(meeting.title);
    const titleWords = titleLower.split(/\s+/).filter(w => w.length >= 4);
    for (const word of titleWords) {
      if (lower.includes(word)) score += 5;
    }

    // Session 8: Account name in meeting title or user text
    // If meeting is linked to a deal, check if the account name appears
    if (meeting.deal_id && dealAccountMap.has(meeting.deal_id)) {
      const accountName = dealAccountMap.get(meeting.deal_id)!;
      if (accountName.length >= 3) {
        if (lower.includes(accountName)) score += 6;
        if (titleLower.includes(accountName)) score += 3;
      }
    }

    if (score > 0) {
      candidates.push({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        dealId: meeting.deal_id,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function resolveMeetingMatch(candidates: MeetingCandidate[]): {
  bestMatch: MeetingCandidate | null;
  confidence: ConfidenceLevel;
  ambiguityReason: string | null;
} {
  if (candidates.length === 0) {
    return { bestMatch: null, confidence: 'low', ambiguityReason: null };
  }

  const best = candidates[0];

  // Single candidate with strong score → high confidence
  if (candidates.length === 1 && best.score >= 8) {
    return { bestMatch: best, confidence: 'high', ambiguityReason: null };
  }

  // Multiple candidates: check the gap
  if (candidates.length > 1) {
    const gap = best.score - candidates[1].score;
    if (gap < 3) {
      return {
        bestMatch: null,
        confidence: 'low',
        ambiguityReason: `Multiple meetings match: ${candidates.slice(0, 3).map(c => c.meetingTitle).join(', ')}`,
      };
    }
  }

  // Clear winner with strong score
  if (best.score >= 8) {
    return { bestMatch: best, confidence: 'high', ambiguityReason: null };
  }

  // Session 8: Below threshold — NEVER auto-link.
  // Leave deal_id NULL rather than guess incorrectly.
  return {
    bestMatch: null,
    confidence: 'low',
    ambiguityReason: `Below meeting confidence threshold: ${best.meetingTitle} (score ${best.score})`,
  };
}


/** Try to extract a company/entity name from new deal text */
function extractEntityName(text: string): string | null {
  const patterns = [
    /(?:new deal|opportunity|prospect|lead|account)\s+(?:with|for|from|at)\s+["']?([A-Z][A-Za-z0-9\s&.-]+)/i,
    /(?:just met|spoke with|talked to|inbound from|referred.*?from)\s+(?:someone at|people at|the team at|folks at)?\s*["']?([A-Z][A-Za-z0-9\s&.-]+)/i,
    /(?:starting a conversation with|opening up)\s+["']?([A-Z][A-Za-z0-9\s&.-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Clean up: remove trailing common words
      const cleaned = match[1].trim().replace(/\s+(about|regarding|for|and|but|they|said|are|were|is|was).*$/i, '').trim();
      if (cleaned.length >= 2 && cleaned.length <= 60) return cleaned;
    }
  }

  return null;
}

// ── FOLLOW-UP DETECTION ──────────────────────────────────────
// Detects when a user message is a continuation of the previous turn.
// Signals: short length, no new subject, implicit references to prior context.
// When detected, the UI should route to the question/streaming path
// so the assistant can continue naturally without re-classifying.

const FOLLOW_UP_PATTERNS = [
  /^(yeah|yep|yes|yea|right|ok|okay|sure|exactly|agreed|correct|definitely|absolutely|totally|got it|makes sense|that works|go ahead|do it|let's do it|sounds good|perfect|great|nice|cool|good call|fair|true|hmm|hm|interesting|noted)\b/i,
  /^(and |but |also |what about |how about |what if |could you |can you |should i |would that |does that |is that |so |then )\b/i,
  /^(tell me more|go on|keep going|elaborate|expand on that|say more|more detail|why|how so|how come|really|seriously)\b/i,
];

export function isFollowUp(
  text: string,
  previousMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
): boolean {
  // Need at least one prior exchange (user + assistant) to be a follow-up
  if (previousMessages.length < 2) return false;

  const trimmed = text.trim();

  // Very short messages (< 40 chars) with no explicit new-subject signals → likely follow-up
  if (trimmed.length < 40) {
    // Check for follow-up patterns
    for (const pattern of FOLLOW_UP_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    // Short messages that end with ? are likely follow-up questions
    if (trimmed.endsWith('?') && trimmed.length < 60) return true;
  }

  // If the message has explicit new-subject signals, it's NOT a follow-up
  // (new deal, email draft, meeting debrief, etc. should go through classification)
  if (isNewDealSignal(trimmed)) return false;
  if (isEmailIntent(trimmed)) return false;

  return false;
}

// ── MAIN CLASSIFIER ──────────────────────────────────────────

export function classifyMessage(
  text: string,
  deals: DealWithAccount[],
  meetings: MeetingRow[],
): ClassificationResult {
  const trimmed = text.trim();

  // Score all candidates upfront — we'll attach them to every result
  const dealCandidates = scoreDealCandidates(trimmed, deals);
  // Session 8: Pass deals to meeting scoring for account name cross-referencing
  const meetingCandidates = scoreMeetingCandidates(trimmed, meetings, deals);
  const dealResolution = resolveDealMatch(dealCandidates);
  const meetingResolution = resolveMeetingMatch(meetingCandidates);

  // Helper to build a result with candidates always attached
  function makeResult(
    overrides: Partial<ClassificationResult> & Pick<ClassificationResult, 'bucket' | 'confidence'>,
  ): ClassificationResult {
    return {
      matchedDealId: null,
      matchedDealName: null,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: null,
      extractedEntityName: null,
      ambiguityReason: null,
      allDealCandidates: dealCandidates,
      allMeetingCandidates: meetingCandidates,
      universalRoute: null,
      ...overrides,
    };
  }

  // ── BUCKET 1: PURE QUESTION (no save) ─────────────────────
  if (isQuestion(trimmed) && !isMeetingContext(trimmed)) {
    return makeResult({
      bucket: 'question',
      confidence: 'high',
      matchedDealId: dealResolution.bestMatch?.dealId ?? null,
      matchedDealName: dealResolution.bestMatch?.dealName ?? null,
    });
  }

  // ── BUCKET 2: EMAIL / DRAFT INTENT ────────────────────────
  if (isEmailIntent(trimmed)) {
    const hasDeal = dealResolution.bestMatch && dealResolution.confidence === 'high';
    return makeResult({
      bucket: 'email_draft',
      confidence: hasDeal ? 'high' : 'low',
      matchedDealId: hasDeal ? dealResolution.bestMatch!.dealId : null,
      matchedDealName: hasDeal ? dealResolution.bestMatch!.dealName : null,
      clarificationQuestion: hasDeal ? null : 'Which item is this email about?',
      ambiguityReason: dealResolution.ambiguityReason,
    });
  }

  // ── BUCKET 3: NEW DEAL / NEW OPPORTUNITY ──────────────────
  if (isNewDealSignal(trimmed)) {
    const entityName = extractEntityName(trimmed);
    return makeResult({
      bucket: 'new_deal',
      confidence: 'high',
      extractedEntityName: entityName,
    });
  }

  // ── BUCKET 4: MEETING CONTEXT ─────────────────────────────
  if (isMeetingContext(trimmed)) {
    const hasMeeting = meetingResolution.bestMatch && meetingResolution.confidence === 'high';
    const hasDeal = dealResolution.bestMatch && dealResolution.confidence === 'high';

    if (hasMeeting) {
      // Strong meeting match — use its deal linkage, or fall back to deal match
      return makeResult({
        bucket: 'meeting_context',
        confidence: 'high',
        matchedDealId: meetingResolution.bestMatch!.dealId ?? dealResolution.bestMatch?.dealId ?? null,
        matchedDealName: hasDeal ? dealResolution.bestMatch!.dealName : null,
        matchedMeetingId: meetingResolution.bestMatch!.meetingId,
        matchedMeetingTitle: meetingResolution.bestMatch!.meetingTitle,
      });
    }

    // No meeting match but strong deal match — still useful
    if (hasDeal) {
      return makeResult({
        bucket: 'meeting_context',
        confidence: 'high',
        matchedDealId: dealResolution.bestMatch!.dealId,
        matchedDealName: dealResolution.bestMatch!.dealName,
        ambiguityReason: meetingResolution.ambiguityReason,
      });
    }

    // Meeting language, no confident match for deal or meeting
    if (deals.length > 0) {
      // Build a richer clarification question if we have candidates
      const ambiguityReasons: string[] = [];
      if (meetingResolution.ambiguityReason) ambiguityReasons.push(meetingResolution.ambiguityReason);
      if (dealResolution.ambiguityReason) ambiguityReasons.push(dealResolution.ambiguityReason);

      return makeResult({
        bucket: 'meeting_context',
        confidence: 'low',
        // If there's a weak deal match, still include it for context
        matchedDealId: dealResolution.bestMatch?.dealId ?? null,
        matchedDealName: dealResolution.bestMatch?.dealName ?? null,
        matchedMeetingId: meetingResolution.bestMatch?.meetingId ?? null,
        matchedMeetingTitle: meetingResolution.bestMatch?.meetingTitle ?? null,
        clarificationQuestion: 'Which item is this about?',
        ambiguityReason: ambiguityReasons.join('; ') || null,
      });
    }

    // No deals at all — save as general intel
    return makeResult({
      bucket: 'general_intel',
      confidence: 'high',
    });
  }

  // ── BUCKET 5: EXISTING DEAL UPDATE ────────────────────────
  if (dealResolution.bestMatch) {
    if (dealResolution.confidence === 'high') {
      return makeResult({
        bucket: 'existing_deal_update',
        confidence: 'high',
        matchedDealId: dealResolution.bestMatch.dealId,
        matchedDealName: dealResolution.bestMatch.dealName,
        ambiguityReason: dealResolution.ambiguityReason,
      });
    }

    // Session 8: Low confidence deal match — NEVER silently auto-link.
    // Whether single or multiple weak candidates, force clarification.
    // Better to have a missing link than a wrong link.
    return makeResult({
      bucket: 'existing_deal_update',
      confidence: 'low',
      matchedDealId: null,
      matchedDealName: null,
      clarificationQuestion: 'Which item is this about?',
      ambiguityReason: dealResolution.ambiguityReason,
    });
  }

  // ── SESSION 11F: UNIVERSAL ROUTING ─────────────────────────
  // Before falling through to general_intel, try universal routing.
  // This catches life/work inputs that aren't sales-shaped:
  // tasks, items, people, events.
  const universalRoute = routeUniversalIntent(trimmed);
  if (universalRoute) {
    return makeResult({
      bucket: 'general_intel', // Bucket stays general_intel for backward compat
      confidence: 'high',
      universalRoute,
    });
  }

  // ── BUCKET 6: GENERAL INTEL (no clear deal match) ─────────
  if (trimmed.length > 15 && deals.length > 0) {
    return makeResult({
      bucket: 'general_intel',
      confidence: 'high',
    });
  }

  // Short or ambiguous — treat as general intel, no clarification needed
  return makeResult({
    bucket: 'general_intel',
    confidence: 'high',
  });
}

// ── ACKNOWLEDGMENT MESSAGES ──────────────────────────────────
// Short, human, calm. No badges, no banners.
// Session 15C.1: Legacy function preserved for backward compatibility.
// For sync-aware acknowledgments, use lib/chat/acknowledgment.ts instead.

export function getAcknowledgment(
  bucket: MessageBucket,
  dealName: string | null,
  meetingTitle: string | null,
): string {
  switch (bucket) {
    case 'existing_deal_update':
      return dealName
        ? `Logged to ${dealName}.`
        : 'Logged.';
    case 'meeting_context':
      if (meetingTitle) return `Logged to ${meetingTitle}.`;
      if (dealName) return `Logged for ${dealName}.`;
      return 'Logged.';
    case 'general_intel':
      return 'Captured.';
    case 'new_deal':
      return 'Tracked.';
    case 'email_draft':
      return 'Drafting.';
    case 'question':
      return '';
  }
}
