import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { context, intent } = await request.json();

    if (!context || !intent) {
      return NextResponse.json(
        { error: 'Context and intent are required' },
        { status: 400 },
      );
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
Keep it concise — under 150 words unless the context requires more.`,
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
