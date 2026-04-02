// ── SESSION 10: DOMAIN IDENTITY CONSTANTS ───────────────────
// Single source of truth for allowed domain keys, onboarding
// choices, and the universal default.

import type { UserDomainKey } from '@/lib/types';

// ── ALLOWED DOMAIN VALUES ──────────────────────────────────
export const ALLOWED_DOMAIN_KEYS: readonly UserDomainKey[] = [
  'custom',
  'sales',
  'student',
  'consulting',
  'real_estate',
] as const;

// ── UNIVERSAL DEFAULT ──────────────────────────────────────
// Missing domain must NEVER silently mean sales.
export const DEFAULT_DOMAIN_KEY: UserDomainKey = 'custom';

// ── ONBOARDING CHOICES ─────────────────────────────────────
// One-tap selection: "What will you use Jove for?"
export type DomainChoice = {
  label: string;
  domainKey: UserDomainKey;
};

export const DOMAIN_CHOICES: readonly DomainChoice[] = [
  { label: 'Work',               domainKey: 'custom' },
  { label: 'Sales',              domainKey: 'sales' },
  { label: 'School',             domainKey: 'student' },
  { label: 'Consulting',         domainKey: 'consulting' },
  { label: 'Real estate',        domainKey: 'real_estate' },
  { label: 'General / personal', domainKey: 'custom' },
] as const;

// ── VALIDATION ─────────────────────────────────────────────
export function isValidDomainKey(value: unknown): value is UserDomainKey {
  return typeof value === 'string' && (ALLOWED_DOMAIN_KEYS as readonly string[]).includes(value);
}

// ── SAFE RESOLVE ───────────────────────────────────────────
// Returns a valid domain key, falling back to 'custom' (never 'sales').
export function resolveDomainKey(value: unknown): UserDomainKey {
  if (isValidDomainKey(value)) return value;
  return DEFAULT_DOMAIN_KEY;
}
