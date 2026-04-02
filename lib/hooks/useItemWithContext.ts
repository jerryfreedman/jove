// ── SESSION 13: ITEM WITH CONTEXT READ HOOK ────────────────
// Fetches a single item by ID along with linked tasks, recent
// interactions, and people. Returns raw data — no transformations.
// Used by ItemDashboard to render a full item detail view.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { ItemRow, TaskRow, InteractionRow, PersonRow } from '@/lib/types';
import { onReflection } from '@/lib/chat/reflection';

// ── COMPOSITE TYPE ──────────────────────────────────────────

export interface ItemWithContext {
  id: string;
  title: string;
  status: string;
  updated_at: string;

  tasks: TaskRow[];
  interactions: InteractionRow[];
  people: PersonRow[];
}

export interface UseItemWithContextResult {
  item: ItemWithContext | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── HOOK ────────────────────────────────────────────────────

export function useItemWithContext(
  itemId: string | null,
  userId: string | null,
): UseItemWithContextResult {
  const [item, setItem] = useState<ItemWithContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItem = useCallback(async () => {
    if (!itemId || !userId) {
      setItem(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      // Fetch item, tasks, interactions, and people in parallel
      const [itemResult, tasksResult, interactionsResult, peopleResult] = await Promise.all([
        // 1. The item itself
        supabase
          .from('items')
          .select('*')
          .eq('id', itemId)
          .eq('user_id', userId)
          .maybeSingle(),

        // 2. Tasks linked to this item
        supabase
          .from('tasks')
          .select('*')
          .eq('item_id', itemId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),

        // 3. Recent interactions (user-scoped, most recent)
        supabase
          .from('interactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),

        // 4. People (user-scoped)
        supabase
          .from('people')
          .select('*')
          .eq('user_id', userId)
          .order('last_interaction_at', { ascending: false, nullsFirst: false })
          .limit(10),
      ]);

      if (itemResult.error) {
        setError(itemResult.error.message);
        setItem(null);
        return;
      }

      if (!itemResult.data) {
        setError('Item not found or not yet available');
        setItem(null);
        return;
      }

      const itemRow = itemResult.data as ItemRow;

      setItem({
        id: itemRow.id,
        title: itemRow.name,
        status: itemRow.status,
        updated_at: itemRow.updated_at,
        tasks: (tasksResult.data ?? []) as TaskRow[],
        interactions: (interactionsResult.data ?? []) as InteractionRow[],
        people: (peopleResult.data ?? []) as PersonRow[],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [itemId, userId]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  // Auto-refetch on reflection events
  useEffect(() => {
    const unsubs = [
      onReflection('item:created', fetchItem),
      onReflection('data:changed', fetchItem),
    ];
    return () => unsubs.forEach(u => u());
  }, [fetchItem]);

  return { item, loading, error, refetch: fetchItem };
}
