// ── SESSION 9: ITEMS READ HOOK ──────────────────────────────
// Query hook for user's items. Follows the useTasks pattern:
//   - Normalized shape: { items, loading, error, refetch }
//   - Reflection-driven auto-refetch
//   - Sensible default sort: non-done first, starred, due soon, recency

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { ItemRow } from '@/lib/types';
import { onReflection } from '@/lib/chat/reflection';

// ── RESULT SHAPE ──────────────────────────────────────────────

export interface UseItemsResult {
  items: ItemRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── SORT: Active relevance ────────────────────────────────────
// 1. Non-done/dropped first
// 2. Starred first
// 3. Items with due dates before those without
// 4. Soonest due first
// 5. Most recently active first

function itemRelevanceSort(a: ItemRow, b: ItemRow): number {
  const doneStatuses = new Set(['done', 'dropped']);
  const aIsDone = doneStatuses.has(a.status);
  const bIsDone = doneStatuses.has(b.status);
  if (aIsDone !== bIsDone) return aIsDone ? 1 : -1;

  // Starred items first
  if (a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;

  // Items with due dates first
  if (a.due_at && !b.due_at) return -1;
  if (!a.due_at && b.due_at) return 1;
  if (a.due_at && b.due_at) {
    const diff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    if (diff !== 0) return diff;
  }

  // Most recently active first
  return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
}

// ── HOOK ──────────────────────────────────────────────────────

export function useItems(userId: string | null): UseItemsResult {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('items')
        .select('*')
        .eq('user_id', userId)
        .order('last_activity_at', { ascending: false })
        .limit(50);

      if (fetchErr) {
        setError(fetchErr.message);
        setItems([]);
      } else {
        const sorted = (data ?? []) as ItemRow[];
        sorted.sort(itemRelevanceSort);
        setItems(sorted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Auto-refetch on reflection events
  useEffect(() => {
    const unsubs = [
      onReflection('item:created', fetchItems),
      onReflection('data:changed', fetchItems),
    ];
    return () => unsubs.forEach(u => u());
  }, [fetchItems]);

  return { items, loading, error, refetch: fetchItems };
}

// ── DERIVED: Active items only ────────────────────────────────
// Excludes done/dropped. For truth engine and control panel input.

export function useActiveItems(userId: string | null): UseItemsResult {
  const result = useItems(userId);
  const activeItems = result.items.filter(
    i => i.status !== 'done' && i.status !== 'dropped',
  );
  return { ...result, items: activeItems };
}
