import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL } from '@/lib/constants';

export async function POST(request: NextRequest) {
  try {
    const {
      userId,
      confirmedIds,
      snoozedIds,
      meetingCount,
      attentionCount,
    } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options as never)
              );
            } catch {}
          },
        },
      }
    );

    const today = new Date().toISOString().split('T')[0];

    // Check if briefing summary already exists for today
    // Session 4: filter by category to avoid matching chat_summary rows
    const { data: existing } = await supabase
      .from('thread_summaries')
      .select('id')
      .eq('user_id', userId)
      .eq('summary_date', today)
      .or('category.eq.briefing_summary,category.is.null')
      .maybeSingle();

    if (existing) {
      // Update existing
      await supabase
        .from('thread_summaries')
        .update({
          confirmed_action_ids: confirmedIds ?? [],
          snoozed_action_ids:   snoozedIds ?? [],
        })
        .eq('id', existing.id);
      return NextResponse.json({ updated: true });
    }

    // Generate summary content
    let summaryContent = `Briefing on ${today}. `;
    summaryContent += `Meetings today: ${meetingCount ?? 0}. `;
    summaryContent += `Deals needing attention: ${attentionCount ?? 0}. `;
    if (confirmedIds?.length > 0) {
      summaryContent += `Confirmed ${confirmedIds.length} action item(s). `;
    }
    if (snoozedIds?.length > 0) {
      summaryContent += `Snoozed ${snoozedIds.length} item(s) for 3 days. `;
    }

    await supabase
      .from('thread_summaries')
      .insert({
        user_id:              userId,
        summary_date:         today,
        content:              summaryContent,
        confirmed_action_ids: confirmedIds ?? [],
        snoozed_action_ids:   snoozedIds ?? [],
        // ── Session 4: Explicit category for retrieval separation ──
        category:             'briefing_summary',
        source_surface:       'briefing',
      });

    return NextResponse.json({ created: true });

  } catch (error) {
    console.error('Save briefing summary error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
