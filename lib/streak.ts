import { STREAK_WEEKDAYS_ONLY, STREAK_GRACE_DAYS, STREAK_MILESTONE_DAYS } from './constants';
import type { StreakLogRow } from './types';

export interface StreakResult {
  currentStreak: number;
  isMilestone:   boolean;
  nextMilestone: number;
  graceDayUsed:  boolean;
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function calculateStreak(logs: StreakLogRow[]): StreakResult {
  if (!logs || logs.length === 0) {
    return {
      currentStreak: 0,
      isMilestone:   false,
      nextMilestone: STREAK_MILESTONE_DAYS[0],
      graceDayUsed:  false,
    };
  }

  // Build a set of dates that have captures
  const capturedDates = new Set(logs.map(l => l.log_date));

  // Walk backwards from today counting the streak
  const today      = new Date();
  let streak       = 0;
  let graceDayUsed = false;
  let missedCount  = 0;
  const cursor     = new Date(today);

  // If today has no capture yet, that's okay — start from yesterday
  if (!capturedDates.has(toDateString(today))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  // Walk back up to 365 days
  for (let i = 0; i < 365; i++) {
    const dateStr = toDateString(cursor);

    // Skip weekends if weekday-only mode
    if (STREAK_WEEKDAYS_ONLY && !isWeekday(cursor)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }

    if (capturedDates.has(dateStr)) {
      streak++;
      missedCount = 0;
    } else {
      missedCount++;
      if (missedCount === 1 && STREAK_GRACE_DAYS >= 1 && !graceDayUsed) {
        // Use grace day — skip this day, don't break streak
        graceDayUsed = true;
      } else {
        // Streak broken
        break;
      }
    }

    cursor.setDate(cursor.getDate() - 1);
  }

  const nextMilestone = STREAK_MILESTONE_DAYS.find(m => m > streak)
    ?? STREAK_MILESTONE_DAYS[STREAK_MILESTONE_DAYS.length - 1];

  const isMilestone = STREAK_MILESTONE_DAYS.includes(streak);

  return { currentStreak: streak, isMilestone, nextMilestone, graceDayUsed };
}
