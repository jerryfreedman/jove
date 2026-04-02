// lib/semantic-labels.ts
// SESSION 3 + SESSION 10 — Semantic Layer
// Provides adaptive labels based on user domain profile.
// Internal system names (deals, contacts, accounts) never change.
// Only displayed text adapts.
// Session 10: Now reads persisted domain_key, no longer hardcoded sales.

import type { UserDomainProfile, UserDomainKey } from '@/lib/types';
import { resolveDomainKey } from '@/lib/domain';

// ── DOMAIN PRESETS ──────────────────────────────────────────
const DOMAIN_PRESETS: Record<UserDomainKey, Omit<UserDomainProfile, 'domain'>> = {
  sales: {
    primaryEntityLabel: 'Deals',
    contactLabel: 'Contacts',
    accountLabel: 'Accounts',
  },
  real_estate: {
    primaryEntityLabel: 'Listings',
    contactLabel: 'Buyers',
    accountLabel: 'Brokerages',
  },
  student: {
    primaryEntityLabel: 'Projects',
    contactLabel: 'Collaborators',
    accountLabel: 'Organizations',
  },
  consulting: {
    primaryEntityLabel: 'Engagements',
    contactLabel: 'Clients',
    accountLabel: 'Firms',
  },
  custom: {
    primaryEntityLabel: 'Items',
    contactLabel: 'People',
    accountLabel: 'Organizations',
  },
};

// ── DEFAULT PROFILE ─────────────────────────────────────────
// Session 12C: Default is now domain-neutral. No sales bias on first run.
export const DEFAULT_DOMAIN_PROFILE: UserDomainProfile = {
  domain: 'custom',
  primaryEntityLabel: 'Items',
  contactLabel: 'People',
  accountLabel: 'Organizations',
};

// ── BUILD PROFILE FROM DOMAIN KEY ───────────────────────────
export function buildDomainProfile(domain: UserDomainKey): UserDomainProfile {
  const preset = DOMAIN_PRESETS[domain] ?? DOMAIN_PRESETS.custom;
  return { domain, ...preset };
}

// ── LABEL GETTER ────────────────────────────────────────────
type EntityType = 'primary' | 'contact' | 'account';

export function getEntityLabel(
  type: EntityType,
  profile: UserDomainProfile = DEFAULT_DOMAIN_PROFILE,
): string {
  switch (type) {
    case 'primary':
      return profile.primaryEntityLabel || 'Items';
    case 'contact':
      return profile.contactLabel || 'People';
    case 'account':
      return profile.accountLabel || 'Organizations';
    default:
      return 'Items';
  }
}

// ── SINGULAR FORMS ──────────────────────────────────────────
// Simple English singularization for display (e.g. "deal" from "Deals")
const SINGULAR_MAP: Record<string, string> = {
  Deals: 'deal',
  Contacts: 'contact',
  Accounts: 'account',
  Items: 'item',
  People: 'person',
  Listings: 'listing',
  Buyers: 'buyer',
  Brokerages: 'brokerage',
  Projects: 'project',
  Collaborators: 'collaborator',
  Organizations: 'organization',
  Engagements: 'engagement',
  Clients: 'client',
  Firms: 'firm',
};

export function getEntityLabelSingular(
  type: EntityType,
  profile: UserDomainProfile = DEFAULT_DOMAIN_PROFILE,
): string {
  const plural = getEntityLabel(type, profile);
  return SINGULAR_MAP[plural] ?? plural.replace(/s$/i, '').toLowerCase();
}

// ── CONTROL SURFACE LABELS ──────────────────────────────────
// Returns display strings for control surface module headers and deep links.

export function getControlSurfaceLabels(profile: UserDomainProfile = DEFAULT_DOMAIN_PROFILE) {
  const primary = getEntityLabel('primary', profile);
  const contact = getEntityLabel('contact', profile);
  return {
    // Session 15A: Action-first section headers
    needsAttention: 'Do this next',
    whatsNext: 'Up next',
    activeItems: `Active ${primary.toLowerCase()}`,
    people: contact,
    momentum: 'Momentum',
    // Minimal settings access (not primary navigation)
    settings: 'Settings',
  };
}

// ── CHAT PROMPT DOMAIN BLOCK ────────────────────────────────
// Returns a string block to inject into the LLM system prompt.

export function getDomainPromptBlock(profile: UserDomainProfile = DEFAULT_DOMAIN_PROFILE): string {
  return `
The user operates in the domain: ${profile.domain}.
Use the following language when referring to the user's data:
- Primary entities: ${profile.primaryEntityLabel} (singular: ${getEntityLabelSingular('primary', profile)})
- People: ${profile.contactLabel} (singular: ${getEntityLabelSingular('contact', profile)})
- Organizations: ${profile.accountLabel} (singular: ${getEntityLabelSingular('account', profile)})
Always prefer these terms over internal system names like "deals", "contacts", or "accounts".
Do not overuse domain labels — keep language natural.`.trim();
}

// ── SESSION 10: RESOLVE PROFILE FROM RAW VALUE ─────────────
// Safely builds a domain profile from any raw domain_key value.
// Falls back to 'custom' (never 'sales') if invalid/missing.
export function resolveUserDomainProfile(rawDomainKey: unknown): UserDomainProfile {
  return buildDomainProfile(resolveDomainKey(rawDomainKey));
}
