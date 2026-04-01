// ── SESSION 11F: UNIVERSAL PERSISTENCE HELPERS ──────────────
// Write helpers for universal routing primitives.
// Shared by classification routes. No duplicated insert logic.
//
// Helpers:
// - createTaskFromIntent  → writes to tasks table
// - createItemFromIntent  → writes to items table
// - findOrCreatePerson    → finds/creates in people table
// - createEventFromIntent → writes to meetings table (event_type = 'event')
//
// All helpers are narrow, explicit, and null-safe.

import { SupabaseClient } from '@supabase/supabase-js';
import type { PersonReference } from '@/lib/universal-routing';
import { emitReflection } from '@/lib/chat/reflection';
import { checkDuplicateTask } from '@/lib/chat/duplicate-guard';

// ── TASK FROM INTENT ────────────────────────────────────────

export async function createTaskFromIntent(
  supabase: SupabaseClient,
  userId: string,
  params: {
    title: string;
    dueAt?: string | null;
    itemId?: string | null;
    dealId?: string | null;
    meetingId?: string | null;
    personId?: string | null;
  },
): Promise<{ id: string; wasDuplicate?: boolean } | null> {
  // Session 15C.1: Check for duplicate before creating
  const dupCheck = await checkDuplicateTask(supabase, userId, params.title);
  if (dupCheck.isDuplicate && dupCheck.existingId) {
    // Return existing instead of creating duplicate
    return { id: dupCheck.existingId, wasDuplicate: true };
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      title: params.title,
      source: 'user',
      source_type: null,
      priority: null,
      due_at: params.dueAt ?? null,
      item_id: params.itemId ?? null,
      deal_id: params.dealId ?? null,
      meeting_id: params.meetingId ?? null,
      action: params.personId ? { person_id: params.personId } : null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('createTaskFromIntent error:', error);
    return null;
  }
  // Session 15C.1: Trigger reflection so control panel updates immediately
  emitReflection('task:created');
  return data;
}

// ── ITEM FROM INTENT ────────────────────────────────────────

export async function createItemFromIntent(
  supabase: SupabaseClient,
  userId: string,
  params: {
    name: string;
    category?: string | null;
  },
): Promise<{ id: string } | null> {
  // Check for existing item with same name (case-insensitive) to avoid duplicates
  const { data: existing } = await supabase
    .from('items')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', params.name)
    .in('status', ['active', 'paused', 'waiting'])
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Item already exists — return it instead of creating duplicate
    return existing;
  }

  const { data, error } = await supabase
    .from('items')
    .insert({
      user_id: userId,
      name: params.name,
      status: 'active',
      category: params.category ?? null,
      context_score: 50,
      last_activity_at: new Date().toISOString(),
      notes: null,
      is_starred: false,
      snoozed_until: null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('createItemFromIntent error:', error);
    return null;
  }
  // Session 15C.1: Trigger reflection
  emitReflection('item:created');
  return data;
}

// ── FIND OR CREATE PERSON ───────────────────────────────────

export async function findOrCreatePerson(
  supabase: SupabaseClient,
  userId: string,
  ref: PersonReference,
): Promise<{ id: string; isNew: boolean } | null> {
  // 1. Try exact name match (case-insensitive)
  const { data: byName } = await supabase
    .from('people')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', ref.name)
    .limit(1)
    .maybeSingle();

  if (byName) {
    return { id: byName.id, isNew: false };
  }

  // 2. Try relationship match if relational noun was used
  if (ref.relationship) {
    const { data: byRel } = await supabase
      .from('people')
      .select('id')
      .eq('user_id', userId)
      .eq('relationship', ref.relationship)
      .limit(1)
      .maybeSingle();

    if (byRel) {
      return { id: byRel.id, isNew: false };
    }
  }

  // 3. Create new person
  const { data, error } = await supabase
    .from('people')
    .insert({
      user_id: userId,
      name: ref.name,
      relationship: ref.relationship,
      email: null,
      phone: null,
      organization_id: null,
      notes: null,
      last_interaction_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('findOrCreatePerson error:', error);
    return null;
  }
  // Session 15C.1: Trigger reflection
  emitReflection('person:created');
  return { id: data.id, isNew: true };
}

// ── EVENT FROM INTENT ───────────────────────────────────────
// Uses the meetings table with event_type to distinguish events from meetings.

export async function createEventFromIntent(
  supabase: SupabaseClient,
  userId: string,
  params: {
    title: string;
    scheduledAt: string | null;
    eventType: 'event' | 'reminder' | 'deadline';
    personId?: string | null;
  },
): Promise<{ id: string } | null> {
  // If no time, default to end of today
  const scheduledAt = params.scheduledAt ?? endOfToday();

  const { data, error } = await supabase
    .from('meetings')
    .insert({
      user_id: userId,
      deal_id: null,
      title: params.title,
      attendees: null,
      scheduled_at: scheduledAt,
      prep_generated: false,
      debrief_completed: false,
      debrief_prompted_at: null,
      source: 'manual',
      event_type: params.eventType,
    })
    .select('id')
    .single();

  if (error) {
    console.error('createEventFromIntent error:', error);
    return null;
  }
  // Session 15C.1: Trigger reflection
  emitReflection('event:created');
  return data;
}

// ── HELPERS ─────────────────────────────────────────────────

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}
