// lib/semantic-labels.ts
// SESSION 3 — Semantic Layer
// Provides adaptive labels based on user domain profile.
// Internal system names (deals, contacts, accounts) never change.
// Only displayed text adapts.

import type { UserDomainProfile, UserDomainKey } from '@/lib/types';

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
    primaryEntityLabel: 'Deals',
    contactLabel: 'Contacts',
    accountLabel: 'Accounts',
  },
};

// ── DEFAULT PROFILE ─────────────────────────────────────────
export const DEFAULT_DOMAIN_PROFILE: UserDomainProfile = {
  domain: 'sales',
  ...DOMAIN_PRESETS.sales,
};

// ── BUILD PROFILE FROM DOMAIN KEY ───────────────────────────
export function buildDomainProfile(domain: UserDomainKey): UserDomainProfile {
  const preset = DOMAIN_PRESETS[domain] ?? DOMAIN_PRESETS.sales;
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
      return profile.primaryEntityLabel || 'Deals';
    case 'contact':
      return profile.contactLabel || 'Contacts';
    case 'account':
      return profile.accountLabel || 'Accounts';
    default:
      return 'Deals';
  }
}

// ── SINGULAR FORMS ──────────────────────────────────────────
// Simple English singularization for display (e.g. "deal" from "Deals")
const SINGULAR_MAP: Record<string, string> = {
  Deals: 'deal',
  Contacts: 'contact',
  Accounts: 'account',
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
  return {
    // Zone headers
    whatMatters: 'What matters',
    comingUp: 'Coming up',
    everythingElse: 'Everything else',
    // Surface access labels (domain-adaptive)
    allItems: `All ${primary.toLowerCase()}`,
    meetings: 'Meetings',
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
