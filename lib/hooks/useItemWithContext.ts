// ── SESSION 13+18: ITEM WITH CONTEXT READ HOOK ─────────────
// Fetches a single item by ID along with linked tasks, recent
// interactions, and people. Returns raw data — no transformations.
// Used by ItemDashboard to render a full item detail view.
//
// Session 18: Falls back to deals table when item not found in items table.
// This allows the unified item dashboard to display both items and deals.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { ItemRow, DealRow, TaskRow, InteractionRow, PersonRow } from '@/lib/types';
import { onReflection } from '@/lib/chat/reflection';

// ── COMPOSITE TYPE ──────────────────────────────────────────

export interface ItemWithContext {
  id: string;
  title: string;
  status: string;
  updated_at: string;

  // Deal-origin metadata (present when loaded from deals table)
  dealMeta?: {
    stage: string;
    value: number | null;
    nextAction: string | null;
    accountId: string;
  };

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

// ── DEAL STAGE → STATUS MAPPING ─────────────────────────────

function dealStageToStatus(stage: string): string {
  switch (stage) {
    case 'Closed Won':  return 'completed';
    case 'Closed Lost': return 'archived';
    case 'Prospect':    return 'active';
    case 'Discovery':   return 'active';
    case 'POC':         return 'in_progress';
    case 'Proposal':    return 'in_progress';
    case 'Negotiation': return 'in_progress';
    default:            return 'active';
  }
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

      // ── 1. Try items table first ────────────────────────
      const itemResult = await supabase
        .from('items')
        .select('*')
        .eq('id', itemId)
        .eq('user_id', userId)
        .maybeSingle();

      let source: 'item' | 'deal' = 'item';
      let itemRow: ItemRow | null = null;
      let dealRow: DealRow | null = null;

      if (itemResult.error) {
        setError(itemResult.error.message);
        setItem(null);
        return;
      }

      if (itemResult.data) {
        itemRow = itemResult.data as ItemRow;
      } else {
        // ── 2. Fall back to deals table ─────────────────
        const dealResult = await supabase
          .from('deals')
          .select('*')
          .eq('id', itemId)
          .eq('user_id', userId)
          .maybeSingle();

        if (dealResult.error) {
          setError(dealResult.error.message);
          setItem(null);
          return;
        }

        if (!dealResult.data) {
          setError('Item not found or not yet available');
          setItem(null);
          return;
        }

        dealRow = dealResult.data as DealRow;
        source = 'deal';
      }

      // ── 3. Fetch related data in parallel ─────────────
      // Tasks: linked by item_id or deal_id depending on source
      const taskFilter = source === 'item'
        ? supabase.from('tasks').select('*').eq('item_id', itemId).eq('user_id', userId)
        : supabase.from('tasks').select('*').eq('deal_id', itemId).eq('user_id', userId);

      const [tasksResult, interactionsResult, peopleResult] = await Promise.all([
        taskFilter.order('created_at', { ascending: false }).limit(10),

        // Interactions scoped to user (recent)
        supabase
          .from('interactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),

        // People scoped to user
        supabase
          .from('people')
          .select('*')
          .eq('user_id', userId)
          .order('last_interaction_at', { ascending: false, nullsFirst: false })
          .limit(10),
      ]);

      if (source === 'item' && itemRow) {
        setItem({
          id: itemRow.id,
          title: itemRow.name,
          status: itemRow.status,
          updated_at: itemRow.updated_at,
          tasks: (tasksResult.data ?? []) as TaskRow[],
          interactions: (interactionsResult.data ?? []) as InteractionRow[],
          people: (peopleResult.data ?? []) as PersonRow[],
        });
      } else if (source === 'deal' && dealRow) {
        setItem({
          id: dealRow.id,
          title: dealRow.name,
          status: dealStageToStatus(dealRow.stage),
          updated_at: dealRow.updated_at,
          dealMeta: {
            stage: dealRow.stage,
            value: dealRow.value,
            nextAction: dealRow.next_action,
            accountId: dealRow.account_id,
          },
          tasks: (tasksResult.data ?? []) as TaskRow[],
          interactions: (interactionsResult.data ?? []) as InteractionRow[],
          people: (peopleResult.data ?? []) as PersonRow[],
        });
      }
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
