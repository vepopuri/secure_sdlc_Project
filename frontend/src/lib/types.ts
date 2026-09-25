export type Role = "admin" | "assessor" | "viewer";
export type EngagementStatus = "draft" | "in_progress" | "review" | "final";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  organization: { id: string; name: string };
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  default_target?: number;
  labels: Record<string, string>;
}

export interface FrameworkSummary {
  key: string;
  name: string;
  short_name: string;
  version: string;
  description: string;
  license_note: string;
  source_url: string;
  scale: Scale;
  domain_count: number;
  practice_count: number;
}

export interface Engagement {
  id: string;
  client_name: string;
  app_name: string;
  business_unit: string | null;
  scope: string;
  status: EngagementStatus;
  created_at: string;
  updated_at: string;
  frameworks: { framework_key: string; target_level: number }[];
  document_count: number;
  interview_count: number;
}

export interface DocumentItem {
  id: string;
  kind: "file" | "interview";
  title: string;
  filename: string | null;
  content_type: string | null;
  size_bytes: number;
  interviewee_role: string | null;
  interview_date: string | null;
  redactions: number;
  created_at: string;
  chunk_count: number;
}

export interface DocumentDetail extends DocumentItem {
  text: string;
  chunks: { id: string; ordinal: number; heading: string; text: string }[];
}

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  heading: string;
  document_title: string;
  snippet: string;
  rank: number;
}

export interface Run {
  id: string;
  framework_key: string;
  analyzer: "claude" | "heuristic";
  model: string | null;
  status: "running" | "completed" | "failed";
  domains_total: number;
  domains_done: string[];
  error: string | null;
  usage: Record<string, number>;
  created_at: string;
  finished_at: string | null;
  domains?: { id: string; name: string; practice_count: number }[];
}

export interface Citation {
  chunk_id: string;
  document_id: string;
  document_title: string;
  heading: string;
  quote: string;
}

export interface Recommendation {
  text: string;
  priority: "high" | "medium" | "low";
  horizon: 30 | 60 | 90;
}

export type PracticeStatus = "assessed" | "projected" | "overridden" | "not_assessed";

export interface PracticeResult {
  id: string;
  name: string;
  description: string;
  domain_id: string;
  capabilities: Record<string, number>;
  levels: Record<string, string>;
  target: number;
  score: number | null;
  machine_score: number | null;
  status: PracticeStatus;
  source: "claude" | "heuristic" | "projection" | null;
  confidence: number;
  rationale: string;
  citations: Citation[];
  gaps: string[];
  recommendations: Recommendation[];
  override: { score: number; reason: string; by: string | null; at: string | null } | null;
}

export interface DomainResult {
  id: string;
  name: string;
  current: number | null;
  target: number;
  practice_ids: string[];
}

export interface Results {
  framework: {
    key: string;
    name: string;
    short_name: string;
    version: string;
    scale: Scale;
    license_note: string;
  };
  analyzed_frameworks: string[];
  is_projected: boolean;
  target: number;
  overall: number | null;
  domains: DomainResult[];
  practices: PracticeResult[];
  capabilities: { key: string; name: string; score: number; confidence: number; sources: string[] }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  engagement_id: string | null;
  user_email: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  size_bytes: number;
  tokens: string[];
  created_at: string;
}

export interface ReportSummary {
  executive_summary: string;
  overall: string;
  document_count: number;
  interview_count: number;
  gaps: { framework: string; practice: string; score: number; target: number; gap: string }[];
  roadmap: { text: string; priority: string; horizon: number; practices: string[] }[];
}
