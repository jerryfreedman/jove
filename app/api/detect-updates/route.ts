import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { message, stage, nextAction } = await request.json();

    const result = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system: `You are a data extraction assistant for a sales CRM. Analyze sales rep messages and detect implied database updates. Return ONLY valid JSON — no explanation, no markdown, no preamble.`,
      messages: [{
        role: 'user',
        content: `Message: "${message}"
Current stage: "${stage ?? 'Unknown'}"
Current next action: "${nextAction ?? 'None'}"

Return this exact structure:
{
  "updates": [
    {
      "type": "stage_change|next_action|value|notes|new_contact|log_interaction",
      "description": "one short line describing what changed",
      "to": "new value"
    }
  ]
}
If no updates implied return: { "updates": [] }`,
      }],
    });

    const raw = result.content[0].type === 'text' ? result.content[0].text : '{}';
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    return NextResponse.json(parsed);

  } catch {
    return NextResponse.json({ updates: [] });
  }
}
