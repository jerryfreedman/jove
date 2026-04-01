// ── SESSION 15C: DEDUPLICATION / REDUNDANCY SUPPRESSION ─────
// Lightweight dedupe layer for intelligence outputs.
// Catches: same action phrased differently, repeated across
// surfaces, task and suggestion saying the same thing.
//
// Rule: if two actions mean the same thing, keep the sharper one.

/**
 * Extracts significant words from text by removing articles and prepositions.
 * Lowercases and filters out noise words.
 */
export function extractSignificantWords(text: string): string[] {
  const stopwords = new Set([
    'a', 'an', 'the',
    'to', 'for', 'with', 'on', 'in', 'at', 'of', 'by', 'from', 'about',
  ]);

  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 0 && !stopwords.has(word));
}

/**
 * Extracts the verb and primary target entity from an action string.
 * Returns [verb, targetEntity] or null if unable to parse.
 */
function extractVerbAndTarget(action: string): [string, string] | null {
  const words = extractSignificantWords(action);
  if (words.length === 0) return null;

  const verb = words[0];
  const target = words.slice(1).join(' ') || '';
  return [verb, target];
}

/**
 * Computes word overlap ratio between two strings.
 * Returns 0-1 where 1 is perfect match.
 */
function computeWordOverlap(words1: string[], words2: string[]): number {
  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  let intersection = 0;
  set1.forEach(w => { if (set2.has(w)) intersection++; });

  const unionSet = new Set<string>();
  words1.forEach(w => unionSet.add(w));
  words2.forEach(w => unionSet.add(w));
  const union = unionSet.size;

  return union === 0 ? 0 : intersection / union;
}

/**
 * Removes semantically duplicate actions.
 * - Two actions are duplicates if their lowercase first 3 significant words match
 * - Two actions are duplicates if one is a substring of the other
 * - Two actions are duplicates if they share the same verb + same target entity
 * - When duplicates found, keeps the longer/more specific one
 * - Preserves original order (first occurrence position)
 * - Returns max input length
 */
export function dedupeActions(actions: string[]): string[] {
  if (actions.length <= 1) return actions;

  const result: string[] = [];
  const lowerActions = actions.map(a => a.toLowerCase());

  for (let i = 0; i < actions.length; i++) {
    const currentAction = actions[i];
    const currentLower = lowerActions[i];
    let isDuplicate = false;

    // Check against all previously kept actions
    for (const keptAction of result) {
      const keptLower = keptAction.toLowerCase();

      // Rule 1: Exact match (case-insensitive)
      if (currentLower === keptLower) {
        isDuplicate = true;
        break;
      }

      // Rule 2: Substring match
      if (currentLower.includes(keptLower) || keptLower.includes(currentLower)) {
        isDuplicate = true;
        break;
      }

      // Rule 3: Same verb + target entity overlap
      const currentVerbTarget = extractVerbAndTarget(currentAction);
      const keptVerbTarget = extractVerbAndTarget(keptAction);

      if (currentVerbTarget && keptVerbTarget) {
        const [currentVerb, currentTarget] = currentVerbTarget;
        const [keptVerb, keptTarget] = keptVerbTarget;

        if (currentVerb === keptVerb) {
          // Check if targets are the same or highly similar
          if (currentTarget === keptTarget) {
            isDuplicate = true;
            break;
          }

          // Check for significant word overlap in targets
          const currentWords = extractSignificantWords(currentTarget);
          const keptWords = extractSignificantWords(keptTarget);
          const overlap = computeWordOverlap(currentWords, keptWords);

          if (overlap > 0.5) {
            isDuplicate = true;
            break;
          }
        }
      }

      // Rule 4: First 3 significant words match
      const currentSig = extractSignificantWords(currentAction).slice(0, 3);
      const keptSig = extractSignificantWords(keptAction).slice(0, 3);

      if (currentSig.length > 0 && keptSig.length > 0 &&
          currentSig.length === keptSig.length &&
          currentSig.every((w, idx) => w === keptSig[idx])) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(currentAction);
    } else {
      // If it's a duplicate but longer/more specific, replace the kept version
      const replacedIdx = result.findIndex(kept => {
        const keptLower = kept.toLowerCase();
        const currentLower = currentAction.toLowerCase();

        // Replace if current is significantly longer and contains the kept one
        if (currentAction.length > kept.length && currentLower.includes(keptLower)) {
          return true;
        }

        return false;
      });

      if (replacedIdx !== -1) {
        result[replacedIdx] = currentAction;
      }
    }
  }

  return result;
}

/**
 * Removes duplicate surface items based on semantic title similarity.
 * Same rules as dedupeActions but operates on objects with title field.
 * Keeps first occurrence when duplicates found.
 */
export function dedupeSurfaceItems<T extends { title: string; id: string }>(items: T[]): T[] {
  if (items.length <= 1) return items;

  const result: T[] = [];
  const lowerTitles = items.map(item => item.title.toLowerCase());

  for (let i = 0; i < items.length; i++) {
    const currentItem = items[i];
    const currentLower = lowerTitles[i];
    let isDuplicate = false;

    // Check against all previously kept items
    for (const keptItem of result) {
      const keptLower = keptItem.title.toLowerCase();

      // Rule 1: Exact match
      if (currentLower === keptLower) {
        isDuplicate = true;
        break;
      }

      // Rule 2: Substring match
      if (currentLower.includes(keptLower) || keptLower.includes(currentLower)) {
        isDuplicate = true;
        break;
      }

      // Rule 3: Same verb + target entity overlap
      const currentVerbTarget = extractVerbAndTarget(currentItem.title);
      const keptVerbTarget = extractVerbAndTarget(keptItem.title);

      if (currentVerbTarget && keptVerbTarget) {
        const [currentVerb, currentTarget] = currentVerbTarget;
        const [keptVerb, keptTarget] = keptVerbTarget;

        if (currentVerb === keptVerb) {
          if (currentTarget === keptTarget) {
            isDuplicate = true;
            break;
          }

          const currentWords = extractSignificantWords(currentTarget);
          const keptWords = extractSignificantWords(keptTarget);
          const overlap = computeWordOverlap(currentWords, keptWords);

          if (overlap > 0.5) {
            isDuplicate = true;
            break;
          }
        }
      }

      // Rule 4: First 3 significant words match
      const currentSig = extractSignificantWords(currentItem.title).slice(0, 3);
      const keptSig = extractSignificantWords(keptItem.title).slice(0, 3);

      if (currentSig.length > 0 && keptSig.length > 0 &&
          currentSig.length === keptSig.length &&
          currentSig.every((w, idx) => w === keptSig[idx])) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(currentItem);
    }
  }

  return result;
}

/**
 * Computes redundancy score of an action relative to existing actions.
 * Returns 0-1 where:
 * - 1.0 = exact duplicate
 * - 0.8 = substring match
 * - 0.6 = same verb + overlapping target words (>50% overlap)
 * - 0.3 = same verb only
 * - 0.0 = no overlap
 */
export function computeRedundancy(action: string, existingActions: string[]): number {
  if (existingActions.length === 0) return 0;

  const actionLower = action.toLowerCase();
  let maxRedundancy = 0;

  for (const existing of existingActions) {
    const existingLower = existing.toLowerCase();

    // Exact match → 1.0
    if (actionLower === existingLower) {
      return 1.0;
    }

    // Substring match → 0.8
    if (actionLower.includes(existingLower) || existingLower.includes(actionLower)) {
      maxRedundancy = Math.max(maxRedundancy, 0.8);
      continue;
    }

    // Same verb + overlapping targets → 0.6
    const actionVerbTarget = extractVerbAndTarget(action);
    const existingVerbTarget = extractVerbAndTarget(existing);

    if (actionVerbTarget && existingVerbTarget) {
      const [actionVerb, actionTarget] = actionVerbTarget;
      const [existingVerb, existingTarget] = existingVerbTarget;

      if (actionVerb === existingVerb) {
        const actionWords = extractSignificantWords(actionTarget);
        const existingWords = extractSignificantWords(existingTarget);
        const overlap = computeWordOverlap(actionWords, existingWords);

        if (overlap > 0.5) {
          maxRedundancy = Math.max(maxRedundancy, 0.6);
          continue;
        }

        // Same verb only → 0.3
        maxRedundancy = Math.max(maxRedundancy, 0.3);
      }
    }
  }

  return maxRedundancy;
}
