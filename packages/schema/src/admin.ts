/** Private operator API; every endpoint requires a verified Access identity. */
export type ModerationStatus = 'approved' | 'pending_review' | 'blocked';
export interface AdminCatalogItem {
  runId: string;
  url: string;
  host: string;
  title: string;
  status: ModerationStatus;
  reason: string;
  createdAt: string;
  artifactsAvailable: boolean;
  curated: boolean;
  refreshRequested: boolean;
}
export interface AdminCatalogResponse {
  items: AdminCatalogItem[];
  nextCursor: string | null;
}
export interface AdminModerationEvent {
  id: string;
  actor: string;
  action: string;
  reason: string;
  createdAt: string;
}
export interface AdminPolicyRule {
  scope: 'url' | 'domain';
  target: string;
  blocked: boolean;
  reason: string;
  updatedAt: string;
}
export interface AdminCaptureAttempt {
  jobId: string;
  url: string;
  status: string;
  reason: string | null;
  runId: string | null;
  updatedAt: string;
}
export interface AdminAttemptsResponse {
  items: AdminCaptureAttempt[];
  nextCursor: string | null;
}
export interface AdminRunDetail extends AdminCatalogItem {
  submittedUrl: string;
  provider: string;
  policyVersion: string;
  captureId: string;
  screenshotUrl: string;
  textures: { slice: number; evidenceUrl: string }[];
  stages: { stageId: string; evidenceUrl: string }[];
  events: AdminModerationEvent[];
  rules: AdminPolicyRule[];
}
export interface AdminDecisionRequest {
  status: ModerationStatus;
  reason: string;
}
export interface AdminRuleRequest {
  scope: 'url' | 'domain';
  target: string;
  blocked: boolean;
  reason: string;
}
