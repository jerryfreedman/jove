import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { context } = await request.json();
    if (!context) {
      return NextResponse.json({ suggestion: null });
    }

    const message = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 120,
      system: `You are a chief of staff for a sales professional.
Write ONE specific, actionable sentence about the single most important
thing they should do right now based on the context provided.
Be specific — name the deal and the action.
No preamble. No labels. Just the sentence.
Maximum 25 words.`,
      messages: [
        {
          role:    'user',
          content: `Sales context: ${context}\n\nWhat is the single most important action to take right now?`,
        },
      ],
    });

    const suggestion = message.content[0].type === 'text'
      ? message.content[0].text.trim()
      : null;

    return NextResponse.json({ suggestion });

  } catch (error) {
    console.error('Do this first error:', error);
    return NextResponse.json({ suggestion: null });
  }
}
