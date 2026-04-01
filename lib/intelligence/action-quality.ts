// ── SESSION 15C: ACTION QUALITY FILTER ──────────────────────
// Scores candidate actions before they are shown.
// Evaluates: specificity, verb strength, contextual usefulness,
// redundancy, and time relevance.
//
// Weak actions are suppressed or improved.
// Strong actions are surfaced first.
//
// Rule: if an action could mean anything, it means nothing.

/**
 * Represents the quality score breakdown for an action
 */
export interface ActionQualityScore {
  specificity: number; // 0-1: how specific/detailed is the action
  verbStrength: number; // 0-1: how strong/actionable is the verb
  contextualUsefulness: number; // 0-1: presence of named person, time, object
  redundancy: number; // 0-1: lower = less redundant = better
  timeRelevance: number; // 0-1: presence of time indicators
  total: number; // 0-1: weighted average
}

export interface ActionImprovementContext {
  person?: string;
  time?: string;
  topic?: string;
}

// Weak action patterns that should be suppressed or improved
export const WEAK_ACTION_PATTERNS: RegExp[] = [
  /^follow\s+up$/i,
  /^check\s+in$/i,
  /^review\s+project$/i,
  /^think\s+about/i,
  /^consider\s+/i,
  /^maybe\s+/i,
  /^possibly\s+/i,
  /^look\s+at/i,
  /^look\s+into/i,
];

// Strong verbs - clearly actionable, high confidence
const STRONG_VERBS = new Set([
  "confirm",
  "schedule",
  "send",
  "call",
  "prepare",
  "decide",
  "align",
  "update",
  "lock",
  "ask",
  "draft",
  "book",
  "block",
  "submit",
  "notify",
  "escalate",
  "launch",
  "deploy",
  "ship",
  "finish",
  "complete",
  "resolve",
  "fix",
]);

// Medium verbs - somewhat actionable, moderate confidence
const MEDIUM_VERBS = new Set([
  "review",
  "check",
  "follow",
  "create",
  "start",
  "open",
  "set",
  "define",
  "handle",
  "address",
  "run",
  "test",
  "verify",
  "organize",
  "clean",
]);

// Weak/penalized verbs - low confidence, non-committal
const WEAK_VERBS = new Set([
  "think",
  "consider",
  "maybe",
  "possibly",
  "look",
]);

/**
 * Extracts the first word from an action string and normalizes it
 */
function extractFirstWord(action: string): string {
  return action.trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Scores specificity based on word count and content
 * 3-8 words is ideal range
 */
function scoreSpecificity(action: string): number {
  const words = action.trim().split(/\s+/).length;

  if (words >= 4 && words <= 6) {
    return 1.0; // Ideal range
  } else if ((words === 3 || words === 7 || words === 8) && words > 0) {
    return 0.8; // Acceptable range
  } else if (words === 1 || words === 2) {
    return 0.5; // Too brief
  } else if (words > 8) {
    return 0.3; // Too long
  }

  return 0.5;
}

/**
 * Scores verb strength based on action classification
 */
function scoreVerbStrength(action: string): number {
  const firstWord = extractFirstWord(action);

  if (STRONG_VERBS.has(firstWord)) {
    return 1.0;
  } else if (MEDIUM_VERBS.has(firstWord)) {
    return 0.6;
  } else if (WEAK_VERBS.has(firstWord)) {
    return 0.1;
  }

  // Check if first word is a verb-like word at all
  // If it's clearly not a verb (starts with preposition, noun patterns), penalize
  if (/^(the|a|an|my|your|his|her|its|our|their)$/i.test(firstWord)) {
    return 0.3;
  }

  // Assume unknown first words are at least attempted verbs
  return 0.5;
}

/**
 * Scores contextual usefulness based on presence of:
 * - Named person
 * - Specific time
 * - Specific object/topic
 * Base score: 0.25, each addition adds 0.25 (max 1.0)
 */
function scoreContextualUsefulness(action: string): number {
  let score = 0.25; // Base score

  // Check for potential person indicators (capitalized words, common pronouns)
  const capitalizedWords = (action.match(/\b[A-Z][a-z]+/g) || []).length;
  if (capitalizedWords > 0) {
    score += 0.25; // Named person/entity
  }

  // Check for time indicators
  if (
    /\b(today|tomorrow|now|tonight|this\s+(week|month|year|quarter|day)|next\s+(week|month|year|quarter|day)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b/i.test(
      action
    )
  ) {
    score += 0.25; // Specific time
  }

  // Check for specific objects/topics (words after action verb)
  const words = action.trim().split(/\s+/);
  if (words.length > 1) {
    score += 0.25; // Has specific object/topic
  }

  return Math.min(score, 1.0);
}

/**
 * Scores time relevance based on presence of time words
 */
function scoreTimeRelevance(action: string): number {
  const timePattern =
    /\b(today|tomorrow|now|tonight|this\s+(week|month|year|quarter|day)|next\s+(week|month|year|quarter|day)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b/i;

  return timePattern.test(action) ? 1.0 : 0.5;
}

/**
 * Calculates redundancy score based on similarity to other actions
 * For single action scoring, returns 0 (no redundancy)
 */
function scoreRedundancy(action: string, otherActions?: string[]): number {
  if (!otherActions || otherActions.length === 0) {
    return 0; // No redundancy with no comparison set
  }

  const actionWords = action.toLowerCase().split(/\s+/).slice(0, 3).join(" ");

  // Check if similar action exists
  for (const other of otherActions) {
    const otherWords = other
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 3)
      .join(" ");

    if (actionWords === otherWords && action !== other) {
      return 1.0; // Duplicate found
    }
  }

  return 0; // No redundancy detected
}

/**
 * Scores a single action string
 */
export function scoreAction(
  action: string,
  otherActions?: string[]
): ActionQualityScore {
  const specificity = scoreSpecificity(action);
  const verbStrength = scoreVerbStrength(action);
  const contextualUsefulness = scoreContextualUsefulness(action);
  const redundancy = scoreRedundancy(action, otherActions);
  const timeRelevance = scoreTimeRelevance(action);

  // Weighted average: 0.25 + 0.30 + 0.25 + 0.10 + 0.10 = 1.0
  const total =
    specificity * 0.25 +
    verbStrength * 0.3 +
    contextualUsefulness * 0.25 +
    (1 - redundancy) * 0.1 +
    timeRelevance * 0.1;

  return {
    specificity,
    verbStrength,
    contextualUsefulness,
    redundancy,
    timeRelevance,
    total: Math.min(Math.max(total, 0), 1.0), // Clamp to 0-1
  };
}

/**
 * Filters and sorts actions by quality score
 * Deduplicates by semantic similarity (lowercase first 3 words)
 * Returns actions sorted by total score descending
 */
export function filterActions(
  actions: string[],
  minScore: number = 0.35
): string[] {
  // Score all actions
  const scored = actions.map((action) => ({
    action,
    score: scoreAction(action, actions),
  }));

  // Deduplicate by first 3 words match (keep higher scoring one)
  const seen = new Map<string, typeof scored[0]>();

  for (const item of scored) {
    const key = item.action
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 3)
      .join(" ");

    const existing = seen.get(key);
    if (!existing || item.score.total > existing.score.total) {
      seen.set(key, item);
    }
  }

  // Filter by minimum score and sort by total descending
  return Array.from(seen.values())
    .filter((item) => item.score.total >= minScore)
    .sort((a, b) => b.score.total - a.score.total)
    .map((item) => item.action);
}

/**
 * Quick check if an action is too weak to display
 */
export function isWeakAction(action: string): boolean {
  const score = scoreAction(action);
  const firstWord = extractFirstWord(action);
  const words = action.trim().split(/\s+/).length;

  // Check score threshold
  if (score.total < 0.35) {
    return true;
  }

  // Check weak verb at start
  if (WEAK_VERBS.has(firstWord)) {
    return true;
  }

  // Check if too short with no named target
  if (words <= 2 && score.contextualUsefulness < 0.5) {
    return true;
  }

  // Check for common filler patterns
  for (const pattern of WEAK_ACTION_PATTERNS) {
    if (pattern.test(action)) {
      return true;
    }
  }

  return false;
}

/**
 * Attempts to improve a weak action using available context
 */
export function improveAction(
  action: string,
  context?: ActionImprovementContext
): string {
  if (!context) {
    return action; // No context, cannot improve
  }

  const lowerAction = action.toLowerCase().trim();

  // "Follow up" patterns
  if (/^follow\s+up$/i.test(lowerAction)) {
    if (context.person) {
      return `Follow up with ${context.person}`;
    }
    if (context.topic) {
      return `Follow up on ${context.topic}`;
    }
  }

  // "Follow up" with words after it
  if (/^follow\s+up\s+/i.test(lowerAction)) {
    const remaining = action.substring(9).trim(); // Remove "Follow up "
    if (context.person) {
      return `Follow up with ${context.person} about ${remaining}`;
    }
  }

  // "Review" patterns
  if (/^review\s+/i.test(lowerAction) && context.topic) {
    return `Review ${context.topic}`;
  }
  if (/^review$/i.test(lowerAction) && context.topic) {
    return `Review ${context.topic}`;
  }

  // "Check in" patterns
  if (/^check\s+in$/i.test(lowerAction)) {
    if (context.person) {
      return `Check in with ${context.person}`;
    }
    if (context.topic) {
      return `Check in on ${context.topic}`;
    }
  }

  // If no improvement possible, return original
  return action;
}
