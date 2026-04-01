import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { SUPABASE_URL } from '@/lib/constants';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
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
                cookieStore.set(name, value, options as Record<string, unknown>)
              );
            } catch {
              // ignore
            }
          },
        },
      }
    );

    // Fetch last 10 sent emails
    const { data: emails } = await supabase
      .from('interactions')
      .select('raw_content, final_sent_content, created_at')
      .eq('user_id', userId)
      .in('type', ['email_sent', 'draft'])
      .not('raw_content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!emails || emails.length === 0) {
      return NextResponse.json({ skipped: true });
    }

    // Fetch existing profile
    const { data: existing } = await supabase
      .from('voice_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    const currentCount = existing?.sample_count ?? 0;

    // Only re-extract if we have enough samples or this is first time
    if (currentCount >= 3 || currentCount === 0) {
      const emailsText = emails
        .map((e: { final_sent_content?: string | null; raw_content: string }, i: number) => {
          const content = e.final_sent_content ?? e.raw_content;
          return `EMAIL ${i + 1}:\n${content.slice(0, 400)}`;
        })
        .join('\n\n---\n\n');

      const result = await anthropic.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: 400,
        system: `You analyze email writing style for the user.
Extract style patterns from the emails provided.
Return ONLY valid JSON — no explanation, no markdown, no preamble.`,
        messages: [{
          role:    'user',
          content: `Analyze these emails and extract the writing style:

${emailsText}

Return this exact JSON structure:
{
  "opening_style": "one sentence describing how they open emails",
  "closing_style": "one sentence describing how they close emails",
  "avg_length": "short|medium|long",
  "formality_level": "casual|semi-formal|formal",
  "common_phrases": ["phrase1", "phrase2", "phrase3"]
}`,
        }],
      });

      const raw = result.content[0].type === 'text'
        ? result.content[0].text
        : '{}';

      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      let extracted: {
        opening_style:   string;
        closing_style:   string;
        avg_length:      string;
        formality_level: string;
        common_phrases:  string[];
      };

      try {
        extracted = JSON.parse(cleaned);
      } catch {
        return NextResponse.json({ error: 'Parse failed' }, { status: 500 });
      }

      const profileData = {
        user_id:          userId,
        opening_style:    extracted.opening_style,
        closing_style:    extracted.closing_style,
        avg_length:       extracted.avg_length,
        formality_level:  extracted.formality_level,
        common_phrases:   extracted.common_phrases ?? [],
        sample_count:     emails.length,
        last_updated_at:  new Date().toISOString(),
      };

      await supabase
        .from('voice_profile')
        .upsert(profileData, { onConflict: 'user_id' });
    } else {
      // Just increment count
      await supabase
        .from('voice_profile')
        .update({
          sample_count:    currentCount + emails.length,
          last_updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Voice profile update error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
