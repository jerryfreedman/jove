// ── SESSION 16: PEOPLE WITH CONTEXT HOOK ────────────────────
// Fetches all people for a user along with their recent
// interactions and linked items. Returns enriched data for
// the PeopleList and PersonProfile views.
// Follows the useItemWithContext pattern.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { PersonRow, InteractionRow, ItemRow, TaskRow } from '@/lib/types';
import { onReflection } from '@/lib/chat/reflection';

// ── COMPOSITE TYPE ──────────────────────────────────────────

export interface PersonWithContext {
  id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;

  interactions: InteractionRow[];
  items: ItemRow[];
}

export interface UsePeopleWithContextResult {
  people: PersonWithContext[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── HOOK ──────────────────────────────────────────────────

export function usePeopleWithContext(userId: string | null): UsePeopleWithContextResult {
  const [people, setPeople] = useState<PersonWithContext[]>([]);
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

      // Fetch people, interactions, tasks, and items in parallel
      const [peopleResult, interactionsResult, tasksResult, itemsResult] = await Promise.all([
        // 1. All people
        supabase
          .from('people')
          .select('*')
          .eq('user_id', userId)
          .order('last_interaction_at', { ascending: false, nullsFirst: false })
          .limit(50),

        // 2. Recent interactions (to match against people)
        supabase
          .from('interactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100),

        // 3. Tasks (may link to people via action.person_id)
        supabase
          .from('tasks')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100),

        // 4. Items
        supabase
          .from('items')
          .select('*')
          .eq('user_id', userId)
          .limit(50),
      ]);

      if (peopleResult.error) {
        setError(peopleResult.error.message);
        setPeople([]);
        return;
      }

      const allPeople = (peopleResult.data ?? []) as PersonRow[];
      const allInteractions = (interactionsResult.data ?? []) as InteractionRow[];
      const allTasks = (tasksResult.data ?? []) as TaskRow[];
      const allItems = (itemsResult.data ?? []) as ItemRow[];

      // Build a map: person_id → task[] (via action.person_id)
      const personTaskMap = new Map<string, TaskRow[]>();
      for (const task of allTasks) {
        const personId = (task.action as Record<string, unknown> | null)?.person_id;
        if (typeof personId === 'string') {
          if (!personTaskMap.has(personId)) personTaskMap.set(personId, []);
          personTaskMap.get(personId)!.push(task);
        }
      }

      // Build a map: item_id → ItemRow
      const itemMap = new Map<string, ItemRow>();
      for (const item of allItems) {
        itemMap.set(item.id, item);
      }

      // Enrich each person with their interactions and linked items
      const enriched: PersonWithContext[] = allPeople.map(person => {
        // Find tasks linked to this person
        const personTasks = personTaskMap.get(person.id) ?? [];

        // Find items linked through those tasks
        const linkedItemIds = new Set<string>();
        for (const task of personTasks) {
          if (task.item_id) linkedItemIds.add(task.item_id);
        }
        const linkedItems = Array.from(linkedItemIds)
          .map(id => itemMap.get(id))
          .filter((item): item is ItemRow => item !== undefined);

        // Find interactions: match by task linkage or by recency around person activity
        // Since interactions don't directly reference people, we use task-linked interactions
        // and also any interactions created close to person's last_interaction_at
        const personInteractions: InteractionRow[] = [];
        const seenInteractionIds = new Set<string>();

        // Interactions linked via tasks (same item_id or deal_id)
        for (const task of personTasks) {
          for (const interaction of allInteractions) {
            if (seenInteractionIds.has(interaction.id)) continue;
            if (
              (task.deal_id && interaction.deal_id === task.deal_id) ||
              (task.item_id && interaction.deal_id === null)
            ) {
              // Broad match — use recency as filter
              if (personInteractions.length < 5) {
                personInteractions.push(interaction);
                seenInteractionIds.add(interaction.id);
              }
            }
          }
        }

        // If no task-linked interactions, use most recent user interactions as context
        if (personInteractions.length === 0) {
          const recentInteractions = allInteractions.slice(0, 5);
          for (const interaction of recentInteractions) {
            if (seenInteractionIds.has(interaction.id)) continue;
            // Check if interaction content mentions this person's name
            const mentionsName = interaction.raw_content
              .toLowerCase()
              .includes(person.name.toLowerCase());
            if (mentionsName) {
              personInteractions.push(interaction);
              seenInteractionIds.add(interaction.id);
            }
          }
        }

        return {
          id: person.id,
          name: person.name,
          relationship: person.relationship,
          email: person.email,
          phone: person.phone,
          notes: person.notes,
          last_interaction_at: person.last_interaction_at,
          created_at: person.created_at,
          updated_at: person.updated_at,
          interactions: personInteractions.slice(0, 5),
          items: linkedItems,
        };
      });

      setPeople(enriched);
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
      onReflection('interaction:created', fetchPeople),
      onReflection('data:changed', fetchPeople),
    ];
    return () => unsubs.forEach(u => u());
  }, [fetchPeople]);

  return { people, loading, error, refetch: fetchPeople };
}
