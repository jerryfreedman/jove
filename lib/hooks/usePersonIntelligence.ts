// ── SESSION 16: PERSON INTELLIGENCE HOOK ────────────────────
// Wraps the deterministic person intelligence engine in a React hook.
// Consumes PersonWithContext, returns summary + lastInteraction +
// nextAction + state. Memoized — only recomputes when data changes.
// Follows the useItemIntelligence pattern.

'use client';

import { useMemo } from 'react';
import { buildPersonIntelligence } from '@/lib/intelligence/personIntelligence';
import type { PersonIntelligenceOutput } from '@/lib/intelligence/personIntelligence';
import type { PersonWithContext } from '@/lib/hooks/usePeopleWithContext';

export function usePersonIntelligence(person: PersonWithContext): PersonIntelligenceOutput {
  return useMemo(() => {
    return buildPersonIntelligence(person.name, {
      interactions: person.interactions,
      items: person.items,
      now: new Date(),
    });
  }, [person.name, person.interactions, person.items]);
}
