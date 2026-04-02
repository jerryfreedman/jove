// ── User Domain Profile (Semantic Layer — Session 3) ────────
export type UserDomainKey = 'sales' | 'real_estate' | 'student' | 'consulting' | 'custom';

export type UserDomainProfile = {
  domain: UserDomainKey;
  primaryEntityLabel: string;   // "Deals", "Projects", "Listings"
  contactLabel: string;         // "Contacts", "Clients", "Buyers"
  accountLabel: string;         // "Accounts", "Organizations", "Brokerages"
};

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  company: string | null;
  role: string | null;
  industry: string | null;
  onboarding_completed: boolean;
  pulse_check_days: number;
  morning_digest_enabled: boolean;
  weather_enabled: boolean;
  /** Session 10: Persisted domain key — determines semantic labels. Default: 'custom'. */
  domain_key: UserDomainKey;
  created_at: string;
  updated_at: string;
};

export type AccountRow = {
  id: string;
  user_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactRow = {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  is_champion: boolean;
  relationship_temperature: string;
  last_interaction_at: string | null;
  relationship_summary: string | null;
  personal_context: string | null;
  communication_style: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DealStage =
  | 'Prospect'
  | 'Discovery'
  | 'POC'
  | 'Proposal'
  | 'Negotiation'
  | 'Closed Won'
  | 'Closed Lost';

export type DealRow = {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  stage: DealStage;
  value: number | null;
  value_type?: 'mrr' | 'arr' | 'one_time';
  next_action: string | null;
  next_action_confirmed: boolean;
  snoozed_until: string | null;
  last_activity_at: string;
  intel_score: number;
  momentum_score: number;
  signal_velocity: number;
  notes: string | null;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
};

export type InteractionType =
  | 'debrief'
  | 'email_received'
  | 'email_sent'
  | 'draft'
  | 'idea'
  | 'note'
  | 'meeting_log';

export type ExtractionStatus =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'failed';

// ── Interaction Source Surfaces ──────────────────────────────
export type InteractionSourceSurface =
  | 'home_chat'
  | 'deal_chat'
  | 'bird'
  | 'capture_sheet'
  | 'briefing'
  | 'system';

// ── Interaction Origin ──────────────────────────────────────
export type InteractionOrigin =
  | 'user'
  | 'assistant'
  | 'system_extracted'
  | 'user_confirmed';

// ── Interaction Intent Type ─────────────────────────────────
export type InteractionIntentType =
  | 'question'
  | 'capture'
  | 'mixed'
  | 'clarification'
  | 'draft_intent'
  | 'debrief'
  | 'general_intel'
  | 'update_confirmation';

// ── Routing Metadata ────────────────────────────────────────
export type InteractionRoutingMetadata = {
  /** Deal IDs that were candidate matches at classification time */
  matchedDealCandidates?: Array<{ dealId: string; dealName: string; score?: number }>;
  /** Meeting IDs that were candidate matches at classification time */
  matchedMeetingCandidates?: Array<{ meetingId: string; meetingTitle: string; score?: number }>;
  /** Contact IDs that were candidate matches */
  matchedContactCandidates?: Array<{ contactId: string; contactName: string }>;
  /** Classifier bucket that was selected */
  classifierBucket?: string;
  /** Whether the path was auto-routed or user-clarified */
  routingPath?: 'auto' | 'user_clarified';
  /** Free-form ambiguity notes */
  ambiguityNotes?: string;
  /** The selected routing path description */
  selectedPath?: string;
  /** Any additional context */
  [key: string]: unknown;
};

export type InteractionRow = {
  id: string;
  user_id: string;
  deal_id: string | null;
  contact_id: string | null;
  type: InteractionType;
  raw_content: string;
  processed_content: string | null;
  final_sent_content: string | null;
  extraction_status: ExtractionStatus;
  extracted_at: string | null;
  // ── Session 2: Memory upgrade fields ──
  source_surface: InteractionSourceSurface | null;
  meeting_id: string | null;
  origin: InteractionOrigin | null;
  intent_type: InteractionIntentType | null;
  routing_confidence: number | null;
  routing_metadata: InteractionRoutingMetadata | null;
  created_at: string;
};

export type SignalType =
  | 'champion_identified'
  | 'timeline_mentioned'
  | 'budget_mentioned'
  | 'competitor_mentioned'
  | 'objection_raised'
  | 'positive_sentiment'
  | 'negative_sentiment'
  | 'next_step_agreed'
  | 'stakeholder_mentioned'
  | 'technical_requirement'
  | 'commercial_signal'
  | 'relationship_context'
  | 'idea_captured'
  | 'risk_identified'
  | 'opportunity_identified';

export type SignalRow = {
  id: string;
  user_id: string;
  deal_id: string | null;
  contact_id: string | null;
  interaction_id: string | null;
  signal_type: SignalType;
  content: string;
  confidence_score: number;
  is_duplicate: boolean;
  created_at: string;
};

export type MeetingSource = 'manual' | 'calendar_screenshot';

// Session 11F: Event type for universal routing — distinguishes meetings from events
export type EventType = 'meeting' | 'event' | 'reminder' | 'deadline';

export type MeetingRow = {
  id: string;
  user_id: string;
  deal_id: string | null;
  title: string;
  attendees: string | null;
  scheduled_at: string;
  prep_generated: boolean;
  debrief_completed: boolean;
  debrief_prompted_at: string | null;
  source: MeetingSource;
  /** Session 11F: Distinguishes meetings from lightweight events */
  event_type: EventType | null;
  created_at: string;
  updated_at: string;
};

export type VoiceProfileRow = {
  id: string;
  user_id: string;
  opening_style: string | null;
  closing_style: string | null;
  avg_length: string | null;
  formality_level: string | null;
  common_phrases: string[] | null;
  sample_count: number;
  last_updated_at: string;
  created_at: string;
};

export type KnowledgeBaseRow = {
  id: string;
  user_id: string;
  product_name: string;
  description: string;
  key_features: string[] | null;
  target_use_cases: string[] | null;
  version: number;
  is_active_deal: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type IdeaStatus = 'raw' | 'developing' | 'linked' | 'archived';

export type IdeaRow = {
  id: string;
  user_id: string;
  deal_id: string | null;
  content: string;
  status: IdeaStatus;
  created_at: string;
  updated_at: string;
};

// ── Thread Summary Category ─────────────────────────────────
export type ThreadSummaryCategory = 'briefing_summary' | 'chat_summary';

export type ThreadSummaryRow = {
  id: string;
  user_id: string;
  summary_date: string;
  content: string;
  confirmed_action_ids: string[] | null;
  snoozed_action_ids: string[] | null;
  /** Distinguishes briefing summaries from chat conversation summaries */
  category: ThreadSummaryCategory | null;
  /** Links to the chat thread that generated this summary */
  thread_id: string | null;
  /** For deal-scoped chat summaries */
  deal_id: string | null;
  /** Where the summarized conversation happened */
  source_surface: ChatSourceSurface | null;
  created_at: string;
};

// ── Chat Threads (thread-level metadata) ────────────────────
export type ChatThreadRow = {
  id: string;
  thread_id: string;
  user_id: string;
  source_surface: ChatSourceSurface;
  primary_deal_id: string | null;
  primary_meeting_id: string | null;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type StreakLogRow = {
  id: string;
  user_id: string;
  log_date: string;
  capture_count: number;
  created_at: string;
};

export type ChatMessageRole = 'user' | 'assistant';
export type ChatSourceSurface = 'home_chat' | 'deal_chat';

export type ChatMessageRow = {
  id: string;
  user_id: string;
  thread_id: string;
  role: ChatMessageRole;
  source_surface: ChatSourceSurface;
  message_text: string;
  deal_id: string | null;
  meeting_id: string | null;
  contact_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DealWithAccount = DealRow & {
  accounts: AccountRow;
};

export type ContactWithAccount = ContactRow & {
  accounts: AccountRow;
};

export type InteractionWithRelations = InteractionRow & {
  deals?: DealRow | null;
  contacts?: ContactRow | null;
};

export type SignalWithRelations = SignalRow & {
  deals?: DealRow | null;
  contacts?: ContactRow | null;
};

export type MeetingWithDeal = MeetingRow & {
  deals?: DealRow | null;
};

// ── Task Types (Session 11A: Universal Primitive) ───────────

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped';
export type TaskSource = 'user' | 'system';
export type TaskSourceType =
  | 'meeting_prep'
  | 'meeting_followup'
  | 'deal_next_step'
  | 'reengage'
  | 'item_next_step';

export type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  status: TaskStatus;
  priority: number | null;
  due_at: string | null;
  item_id: string | null;
  deal_id: string | null;
  meeting_id: string | null;
  source: TaskSource;
  source_type: TaskSourceType | null;
  action: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// ── People Types (Session 11E: Universal Relationship Layer) ─

export type PersonRow = {
  id: string;
  user_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  organization_id: string | null;
  notes: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
};

// ── Item Types (Session 11D: Universal Primary Entity) ─────

export type ItemStatus = 'active' | 'paused' | 'waiting' | 'done' | 'dropped';

export type ItemRow = {
  id: string;
  user_id: string;
  name: string;
  status: ItemStatus;
  category: string | null;
  context_score: number;
  due_at: string | null;
  last_activity_at: string;
  notes: string | null;
  is_starred: boolean;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
};
