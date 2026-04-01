import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const { context, userId } = await request.json();
    if (!context) {
      return NextResponse.json({ suggestion: null });
    }

    const supabase = await createServerSupabaseClient();
    const { data: kbRows } = await supabase
      .from('knowledge_base')
      .select('product_name, description')
      .eq('user_id', userId ?? '')
      .order('created_at', { ascending: true });

    const kbText = kbRows && kbRows.length > 0
      ? kbRows.map((kb: { product_name: string; description: string }) => `${kb.product_name}: ${kb.description}`).join('; ')
      : 'Not specified';

    const message = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 120,
      system: `You are a chief of staff for the user.
Write ONE specific, actionable sentence about the single most important
thing they should do right now based on the context provided.
Be specific — name the item and the action.
No preamble. No labels. Just the sentence.
Maximum 25 words.
What the user is working on: ${kbText}
Reference their actual context when naming specific actions.`,
      messages: [
        {
          role:    'user',
          content: `Current context: ${context}\n\nWhat is the single most important action to take right now?`,
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
