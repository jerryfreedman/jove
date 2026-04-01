// ── SESSION 11B: LIGHTWEIGHT TIME PARSER ───────────────────
// Parses common time phrases into ISO 8601 timestamptz strings.
// Correctness > overreach. Returns null if ambiguous.
//
// Supports:
// - "today", "tonight"
// - "tomorrow", "tomorrow at 3", "tomorrow at 3pm"
// - "at 6", "at 6pm", "at 14:30"
// - "this morning/afternoon/evening"
//
// Does NOT support:
// - "next week", "next Monday" (too ambiguous without day context)
// - Relative durations ("in 2 hours", "in 30 minutes")
// - Complex date expressions
//
// No heavy dependencies. Pure date math.

/**
 * Parse a raw time phrase (extracted by task-intent.ts) into an ISO timestamptz.
 * Returns null if parsing is ambiguous or unsupported.
 */
export function parseTaskTime(rawTimePart: string): string | null {
  if (!rawTimePart) return null;

  const lower = rawTimePart.toLowerCase().trim();
  const now = new Date();

  // ── "today" / "tonight" ──────────────────────────────────
  if (lower === 'today') {
    return endOfDay(now);
  }
  if (lower === 'tonight') {
    return setTime(now, 21, 0); // 9pm today
  }

  // ── "tomorrow" with optional time ────────────────────────
  if (lower === 'tomorrow') {
    return setTime(addDays(now, 1), 9, 0); // 9am tomorrow
  }

  const tomorrowAtMatch = lower.match(
    /^tomorrow\s+(?:at|by|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
  );
  if (tomorrowAtMatch) {
    const time = parseTimeComponents(tomorrowAtMatch[1], tomorrowAtMatch[2], tomorrowAtMatch[3]);
    if (time) return setTime(addDays(now, 1), time.hours, time.minutes);
  }

  // ── "at [time]" (today) ──────────────────────────────────
  const atTimeMatch = lower.match(
    /^(?:at|by|before|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
  );
  if (atTimeMatch) {
    const time = parseTimeComponents(atTimeMatch[1], atTimeMatch[2], atTimeMatch[3]);
    if (time) {
      const target = setTime(now, time.hours, time.minutes);
      // If the time has already passed today, assume tomorrow
      if (new Date(target) <= now) {
        return setTime(addDays(now, 1), time.hours, time.minutes);
      }
      return target;
    }
  }

  // ── "this morning/afternoon/evening" ─────────────────────
  if (lower === 'this morning') {
    return setTime(now, 9, 0);
  }
  if (lower === 'this afternoon') {
    return setTime(now, 14, 0);
  }
  if (lower === 'this evening') {
    return setTime(now, 18, 0);
  }

  // Ambiguous or unsupported — return null rather than guess
  return null;
}

// ── HELPERS ────────────────────────────────────────────────

function parseTimeComponents(
  hourStr: string,
  minuteStr: string | undefined,
  ampm: string | undefined,
): { hours: number; minutes: number } | null {
  let hours = parseInt(hourStr, 10);
  const minutes = minuteStr ? parseInt(minuteStr, 10) : 0;

  if (isNaN(hours) || hours < 0 || hours > 23) return null;
  if (isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  if (ampm) {
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
  } else {
    // No am/pm specified: if hour is 1-6, assume PM (common for tasks)
    // if hour is 7-12, assume contextually (7-11 = AM for morning, 12 = noon)
    // if hour > 12, it's already 24h format
    if (hours >= 1 && hours <= 6) hours += 12;
  }

  return { hours, minutes };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function setTime(date: Date, hours: number, minutes: number): string {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result.toISOString();
}

function endOfDay(date: Date): string {
  const result = new Date(date);
  result.setHours(23, 59, 0, 0);
  return result.toISOString();
}

/**
 * Format a due_at ISO string into a human-friendly phrase for chat confirmation.
 */
export function formatDueAt(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: date.getMinutes() > 0 ? '2-digit' : undefined,
    hour12: true,
  }).toLowerCase();

  if (isToday) {
    // Check if it's end-of-day (no specific time)
    if (date.getHours() === 23 && date.getMinutes() === 59) {
      return 'today';
    }
    return `today at ${timeStr}`;
  }
  if (isTomorrow) {
    if (date.getHours() === 9 && date.getMinutes() === 0) {
      return 'tomorrow';
    }
    return `tomorrow at ${timeStr}`;
  }

  // Further out — use day name or date
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  return `${dayName} at ${timeStr}`;
}
