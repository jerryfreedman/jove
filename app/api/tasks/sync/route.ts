// ── SESSION 11B: TASK SYNC API ROUTE ───────────────────────
// POST /api/tasks/sync
//
// Server-side task sync endpoint. Called at controlled lifecycle
// moments (homepage load with throttling) to persist system-derived
// tasks without write storms.
//
// This route:
// 1. Fetches the user's meetings and deals
// 2. Derives system tasks using the pure task engine
// 3. Upserts them via the persistence layer
//
// Does NOT change any read surfaces. Write-path only.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL } from '@/lib/constants';
import { deriveSystemTasks } from '@/lib/task-engine';
import { syncSystemTasksForUser } from '@/lib/task-persistence';
import type { DealRow } from '@/lib/types';
import type { Meeting } from '@/lib/meeting-types';

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { userId: string };
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    // Fetch meetings and deals in parallel
    const [meetingsRes, dealsRes] = await Promise.all([
      supabase
        .from('meetings')
        .select('id, user_id, deal_id, title, attendees, scheduled_at, prep_generated, debrief_completed, debrief_prompted_at, source, created_at, updated_at')
        .eq('user_id', userId),
      supabase
        .from('deals')
        .select('*')
        .eq('user_id', userId)
        .not('stage', 'in', '("Closed Won","Closed Lost")'),
    ]);

    const meetingRows = meetingsRes.data ?? [];
    const deals = (dealsRes.data ?? []) as DealRow[];

    // Convert MeetingRow → Meeting (same normalization as meeting-store)
    const meetings: Meeting[] = meetingRows.map(row => ({
      id: row.id,
      title: row.title,
      startTime: new Date(row.scheduled_at).getTime(),
      endTime: new Date(row.scheduled_at).getTime() + 60 * 60 * 1000,
      status: 'scheduled' as const,      // Server doesn't have client-side status overrides
      source: row.source === 'manual' ? 'user' as const : 'calendar' as const,
      lastUpdatedAt: new Date(row.updated_at).getTime(),
      dealId: row.deal_id,
      participants: row.attendees ? row.attendees.split(',').map((a: string) => a.trim()) : [],
      attendees: row.attendees,
      prepGenerated: row.prep_generated,
      debriefCompleted: row.debrief_completed,
    }));

    // Derive and sync
    const derivedTasks = deriveSystemTasks(meetings, deals);
    const result = await syncSystemTasksForUser(supabase, userId, derivedTasks);

    return NextResponse.json({
      ok: true,
      derived: derivedTasks.length,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
    });

  } catch (error) {
    console.error('Task sync error:', error);
    return NextResponse.json({ error: 'Task sync failed' }, { status: 500 });
  }
}
