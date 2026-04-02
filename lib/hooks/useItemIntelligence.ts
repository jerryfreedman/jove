// ── SESSION 14: ITEM INTELLIGENCE HOOK ──────────────────────
// Wraps the deterministic intelligence engine in a React hook.
// Consumes ItemWithContext, returns summary + nextAction + state.
// Memoized — only recomputes when item data changes.

'use client';

import { useMemo } from 'react';
import { buildItemIntelligence } from '@/lib/intelligence/itemIntelligence';
import type { ItemIntelligenceOutput } from '@/lib/intelligence/itemIntelligence';
import type { ItemWithContext } from '@/lib/hooks/useItemWithContext';

export function useItemIntelligence(item: ItemWithContext): ItemIntelligenceOutput {
  return useMemo(() => {
    return buildItemIntelligence({
      tasks: item.tasks,
      interactions: item.interactions,
      people: item.people,
      now: new Date(),
    });
  }, [item.tasks, item.interactions, item.people]);
}
