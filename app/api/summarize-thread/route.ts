import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json() as {
      messages: Array<{ role: string; content: string }>;
    };

    if (!messages || messages.length < 2) {
      return NextResponse.json({ summary: null });
    }

    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'Rep' : 'Jove'}: ${m.content}`)
      .join('\n\n');

    const result = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      system: `You summarize conversations concisely. Write 2-3 sentences capturing: what was discussed, any decisions made, and any next steps agreed on. Return only the summary — no labels.`,
      messages: [{
        role: 'user',
        content: `Summarize this conversation:\n\n${conversationText}`,
      }],
    });

    const summary = result.content[0].type === 'text'
      ? result.content[0].text.trim()
      : null;

    return NextResponse.json({ summary });

  } catch {
    return NextResponse.json({ summary: null });
  }
}
