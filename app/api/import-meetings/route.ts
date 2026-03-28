import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';

export async function POST(request: NextRequest) {
  try {
    const { imageBase64, mimeType } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const result = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: {
              type:       'base64',
              media_type: (mimeType ?? 'image/jpeg') as
                'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data:       imageBase64,
            },
          },
          {
            type: 'text',
            text: `Look at this calendar screenshot and extract all visible meetings or events.
Return ONLY valid JSON — no explanation, no markdown.

Return this structure:
{
  "meetings": [
    {
      "title": "meeting title",
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "duration_minutes": 60,
      "attendees": "comma separated names if visible or null"
    }
  ]
}

If no meetings are visible return: { "meetings": [] }
Use today's year if the year is not shown in the screenshot.
Today's date is ${new Date().toISOString().split('T')[0]}.`,
          },
        ],
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

    const parsed = JSON.parse(cleaned);
    return NextResponse.json(parsed);

  } catch (error) {
    console.error('Import meetings error:', error);
    return NextResponse.json({ meetings: [] });
  }
}
