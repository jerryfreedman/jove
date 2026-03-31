// ── CHAT INTELLIGENCE ENGINE ──────────────────────────────────
// Session 3: Deterministic message classification + confidence routing.
// Lightweight, client-side heuristics. No LLM calls for classification.

import type { DealRow, MeetingRow } from '@/lib/types';

// ── CLASSIFICATION BUCKETS ────────────────────────────────────
export type MessageBucket =
  | 'existing_deal_update'
  | 'new_deal'
  | 'general_intel'
  | 'meeting_context'
  | 'email_draft'
  | 'question';

export type ConfidenceLevel = 'high' | 'low';

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
}

type DealWithAccount = DealRow & { accounts: { name: string } | null };

// ── HELPERS ───────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'").replace(/[""]/g, '"').trim();
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = normalize(text);
  return keywords.some(kw => lower.includes(kw));
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

/** Try to match a deal by name/account name mention */
function matchDeal(
  text: string,
  deals: DealWithAccount[],
): { dealId: string; dealName: string; accountName: string | null } | null {
  const lower = normalize(text);

  // Score each deal by how strongly it's referenced
  let bestMatch: { dealId: string; dealName: string; accountName: string | null; score: number } | null = null;

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
    // Partial match — first significant word of deal name (>= 4 chars)
    const dealWords = dealNameLower.split(/\s+/).filter(w => w.length >= 4);
    for (const word of dealWords) {
      if (lower.includes(word)) score += 3;
    }
    // Partial match — first significant word of account name
    if (accountNameLower) {
      const accountWords = accountNameLower.split(/\s+/).filter(w => w.length >= 4);
      for (const word of accountWords) {
        if (lower.includes(word)) score += 3;
      }
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        dealId: deal.id,
        dealName: deal.name,
        accountName: deal.accounts?.name ?? null,
        score,
      };
    }
  }

  // Require a minimum score of 3 (at least one significant word match)
  if (bestMatch && bestMatch.score >= 3) {
    return { dealId: bestMatch.dealId, dealName: bestMatch.dealName, accountName: bestMatch.accountName };
  }
  return null;
}

/** Try to match an active/recent meeting */
function matchMeeting(
  text: string,
  meetings: MeetingRow[],
): { meetingId: string; meetingTitle: string; dealId: string | null } | null {
  const lower = normalize(text);
  const now = Date.now();

  // Priority 1: meeting in progress or just ended (< 2 hours ago)
  const recentMeetings = meetings
    .filter(m => {
      const start = new Date(m.scheduled_at).getTime();
      const end = start + 60 * 60 * 1000;
      return now >= start && now <= end + 2 * 60 * 60 * 1000;
    })
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  // If meeting context language + recent meeting exists, high confidence
  if (recentMeetings.length === 1) {
    return {
      meetingId: recentMeetings[0].id,
      meetingTitle: recentMeetings[0].title,
      dealId: recentMeetings[0].deal_id,
    };
  }

  // Try title match
  for (const meeting of meetings) {
    const titleLower = normalize(meeting.title);
    const titleWords = titleLower.split(/\s+/).filter(w => w.length >= 4);
    for (const word of titleWords) {
      if (lower.includes(word)) {
        return {
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          dealId: meeting.deal_id,
        };
      }
    }
  }

  // If meeting language but multiple recent meetings → ambiguous
  if (recentMeetings.length > 1) {
    return null; // Will trigger clarification
  }

  return null;
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

// ── MAIN CLASSIFIER ──────────────────────────────────────────

export function classifyMessage(
  text: string,
  deals: DealWithAccount[],
  meetings: MeetingRow[],
): ClassificationResult {
  const trimmed = text.trim();

  // ── BUCKET 1: PURE QUESTION (no save) ─────────────────────
  if (isQuestion(trimmed) && !isMeetingContext(trimmed)) {
    // Check if the question references a specific deal for context
    const dealMatch = matchDeal(trimmed, deals);
    return {
      bucket: 'question',
      confidence: 'high',
      matchedDealId: dealMatch?.dealId ?? null,
      matchedDealName: dealMatch?.dealName ?? null,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: null,
      extractedEntityName: null,
    };
  }

  // ── BUCKET 2: EMAIL / DRAFT INTENT ────────────────────────
  if (isEmailIntent(trimmed)) {
    const dealMatch = matchDeal(trimmed, deals);
    return {
      bucket: 'email_draft',
      confidence: dealMatch ? 'high' : 'low',
      matchedDealId: dealMatch?.dealId ?? null,
      matchedDealName: dealMatch?.dealName ?? null,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: dealMatch ? null : 'Which deal is this email about?',
      extractedEntityName: null,
    };
  }

  // ── BUCKET 3: NEW DEAL / NEW OPPORTUNITY ──────────────────
  if (isNewDealSignal(trimmed)) {
    const entityName = extractEntityName(trimmed);
    return {
      bucket: 'new_deal',
      confidence: 'high',
      matchedDealId: null,
      matchedDealName: null,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: null,
      extractedEntityName: entityName,
    };
  }

  // ── BUCKET 4: MEETING CONTEXT ─────────────────────────────
  if (isMeetingContext(trimmed)) {
    const meetingMatch = matchMeeting(trimmed, meetings);
    const dealMatch = matchDeal(trimmed, deals);

    // If we found a meeting, use it
    if (meetingMatch) {
      return {
        bucket: 'meeting_context',
        confidence: 'high',
        matchedDealId: meetingMatch.dealId ?? dealMatch?.dealId ?? null,
        matchedDealName: dealMatch?.dealName ?? null,
        matchedMeetingId: meetingMatch.meetingId,
        matchedMeetingTitle: meetingMatch.meetingTitle,
        clarificationQuestion: null,
        extractedEntityName: null,
      };
    }

    // Meeting language but no clear meeting match — try deal
    if (dealMatch) {
      return {
        bucket: 'meeting_context',
        confidence: 'high',
        matchedDealId: dealMatch.dealId,
        matchedDealName: dealMatch.dealName,
        matchedMeetingId: null,
        matchedMeetingTitle: null,
        clarificationQuestion: null,
        extractedEntityName: null,
      };
    }

    // Meeting language, no deal or meeting match
    if (deals.length > 0) {
      return {
        bucket: 'meeting_context',
        confidence: 'low',
        matchedDealId: null,
        matchedDealName: null,
        matchedMeetingId: null,
        matchedMeetingTitle: null,
        clarificationQuestion: 'Which deal is this about?',
        extractedEntityName: null,
      };
    }

    // No deals at all — save as general intel
    return {
      bucket: 'general_intel',
      confidence: 'high',
      matchedDealId: null,
      matchedDealName: null,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: null,
      extractedEntityName: null,
    };
  }

  // ── BUCKET 5: EXISTING DEAL UPDATE ────────────────────────
  const dealMatch = matchDeal(trimmed, deals);
  if (dealMatch) {
    return {
      bucket: 'existing_deal_update',
      confidence: 'high',
      matchedDealId: dealMatch.dealId,
      matchedDealName: dealMatch.dealName,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: null,
      extractedEntityName: null,
    };
  }

  // ── BUCKET 6: GENERAL INTEL (no clear deal match) ─────────
  // If there are active deals, we should ask whether to link
  // But only if the message seems substantial enough (> 15 chars)
  if (trimmed.length > 15 && deals.length > 0) {
    return {
      bucket: 'general_intel',
      confidence: 'high',
      matchedDealId: null,
      matchedDealName: null,
      matchedMeetingId: null,
      matchedMeetingTitle: null,
      clarificationQuestion: null,
      extractedEntityName: null,
    };
  }

  // Short or ambiguous — treat as general intel, no clarification needed
  return {
    bucket: 'general_intel',
    confidence: 'high',
    matchedDealId: null,
    matchedDealName: null,
    matchedMeetingId: null,
    matchedMeetingTitle: null,
    clarificationQuestion: null,
    extractedEntityName: null,
  };
}

// ── ACKNOWLEDGMENT MESSAGES ──────────────────────────────────
// Short, human, calm. No badges, no banners.

export function getAcknowledgment(
  bucket: MessageBucket,
  dealName: string | null,
  meetingTitle: string | null,
): string {
  switch (bucket) {
    case 'existing_deal_update':
      return dealName
        ? `Got it — added to ${dealName}.`
        : 'Saved that.';
    case 'meeting_context':
      if (meetingTitle) return `Noted — saved to ${meetingTitle}.`;
      if (dealName) return `Got it — saved for ${dealName}.`;
      return 'Saved.';
    case 'general_intel':
      return 'Saved.';
    case 'new_deal':
      return 'Noted.';
    case 'email_draft':
      return 'On it.';
    case 'question':
      return '';
  }
}
