import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const { context, intent, userId } = await request.json();

    if (!context || !intent) {
      return NextResponse.json(
        { error: 'Context and intent are required' },
        { status: 400 },
      );
    }

    const supabase = await createServerSupabaseClient();
    const [{ data: kbRows }, { data: voiceData }] = await Promise.all([
      supabase
        .from('knowledge_base')
        .select('product_name, description, key_features')
        .eq('user_id', userId ?? '')
        .order('created_at', { ascending: true }),
      supabase
        .from('voice_profile')
        .select('opening_style, closing_style, formality_level, avg_length, common_phrases')
        .eq('user_id', userId ?? '')
        .single(),
    ]);

    const voiceProfile = voiceData as {
      opening_style: string | null;
      closing_style: string | null;
      formality_level: string | null;
      avg_length: string | null;
      common_phrases: string[] | null;
    } | null;

    const kbText = kbRows && kbRows.length > 0
      ? kbRows.map((kb: { product_name: string; description: string; key_features: string[] | null }) => {
          const parts = [`${kb.product_name}: ${kb.description}`];
          if (kb.key_features?.length) {
            parts.push(`Features: ${kb.key_features.join(', ')}`);
          }
          return parts.join(' | ');
        }).join('\n')
      : 'Not specified';

    let voiceSection = '';
    if (voiceProfile?.opening_style) {
      const parts = [
        `Opening style: ${voiceProfile.opening_style}`,
        `Closing style: ${voiceProfile.closing_style ?? 'varies'}`,
        `Formality: ${voiceProfile.formality_level ?? 'moderate'}`,
        `Tone length: ${voiceProfile.avg_length ?? 'moderate'}`,
      ];
      if (voiceProfile.common_phrases?.length) {
        parts.push(`Common phrases: ${voiceProfile.common_phrases.join(', ')}`);
      }
      voiceSection = `\n\nWRITING STYLE (match this voice):\n${parts.join('\n')}`;
    }

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: `You are drafting a professional email for a sales professional.
Write in a direct, confident, relationship-aware style.
No filler phrases. No generic openings like "I hope this finds you well."
No sign-off like "Best regards" or "Sincerely" unless the tone clearly calls for it.
Match the user's stated intent exactly.
Format: Subject line first on its own line starting with "Subject:",
then a blank line, then the email body.
Keep it concise — under 150 words unless the context requires more.

Products the user sells:
${kbText}

Reference specific product capabilities naturally where relevant.
Never mention products that aren't relevant to the email context.${voiceSection}`,
      messages: [
        {
          role: 'user',
          content: `Context: ${context}\n\nIntent: ${intent}\n\nWrite the email.`,
        },
      ],
    });

    const draft =
      message.content[0].type === 'text' ? message.content[0].text : '';

    return NextResponse.json({ draft });
  } catch (error) {
    console.error('Draft API error:', error);
    return NextResponse.json(
      { error: 'Draft generation failed' },
      { status: 500 },
    );
  }
}
