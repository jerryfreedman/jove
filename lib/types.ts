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

export type ThreadSummaryRow = {
  id: string;
  user_id: string;
  summary_date: string;
  content: string;
  confirmed_action_ids: string[] | null;
  snoozed_action_ids: string[] | null;
  created_at: string;
};

export type StreakLogRow = {
  id: string;
  user_id: string;
  log_date: string;
  capture_count: number;
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
