// ── SESSION 9: PEOPLE READ HOOK ─────────────────────────────
// Query hook for user's people. Follows the useTasks pattern:
//   - Normalized shape: { people, loading, error, refetch }
//   - Reflection-driven auto-refetch
//   - Default sort: most recently interacted first

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { PersonRow } from '@/lib/types';
import { onReflection } from '@/lib/chat/reflection';

// ── RESULT SHAPE ──────────────────────────────────────────────

export interface UsePeopleResult {
  people: PersonRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── SORT: Interaction recency ─────────────────────────────────
// 1. Most recently interacted first
// 2. People without interaction dates still visible (sorted by created_at)

function peopleRecencySort(a: PersonRow, b: PersonRow): number {
  const aTime = a.last_interaction_at
    ? new Date(a.last_interaction_at).getTime()
    : new Date(a.created_at).getTime();
  const bTime = b.last_interaction_at
    ? new Date(b.last_interaction_at).getTime()
    : new Date(b.created_at).getTime();
  return bTime - aTime;
}

// ── HOOK ──────────────────────────────────────────────────────

export function usePeople(userId: string | null): UsePeopleResult {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPeople = useCallback(async () => {
    if (!userId) {
      setPeople([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('people')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchErr) {
        setError(fetchErr.message);
        setPeople([]);
      } else {
        const sorted = (data ?? []) as PersonRow[];
        sorted.sort(peopleRecencySort);
        setPeople(sorted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  // Auto-refetch on reflection events
  useEffect(() => {
    const unsubs = [
      onReflection('person:created', fetchPeople),
      onReflection('data:changed', fetchPeople),
    ];
    return () => unsubs.forEach(u => u());
  }, [fetchPeople]);

  return { people, loading, error, refetch: fetchPeople };
}
