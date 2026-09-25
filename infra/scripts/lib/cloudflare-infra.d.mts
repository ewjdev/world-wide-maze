// Types for cloudflare-infra.mjs (consumed by apps/worker/test/infra-provision.test.ts).
export type Kind = 'd1' | 'r2' | 'kv' | 'aiGateway';
export type Target = 'production' | 'previews';
export type JsonPath = (string | number)[];

export interface TargetConfig {
  d1: string;
  r2: string;
  kv: string;
  aiGateway: string;
  rateLimitNamespaceIds: Record<string, string>;
}
export interface InfraConfig {
  worker: string;
  wranglerEnv: string;
  domain: string;
  production: TargetConfig;
  previews: TargetConfig & { namePrefix: string };
  secrets: string[];
}
export interface Resource {
  kind: Kind;
  target: Target;
  name: string;
}
export interface PlanItem extends Resource {
  action: 'exists' | 'create' | 'manual';
  id: string | null;
}
export interface Patch {
  path: JsonPath;
  value: unknown;
}
export interface ResolvedIds {
  production: { d1: string | null; kv: string | null };
  previews: { d1: string | null; kv: string | null };
  accountId: string | null;
}

export const RATE_LIMITERS: string[];
export const DOMAIN_PLACEHOLDER: string;
export function parseJsoncWithSpans(text: string): { value: unknown; spans: Map<string, [number, number]> };
export function parseJsonc(text: string): unknown;
export function inlineJson(v: unknown): string;
export function patchJsonc(
  text: string,
  patches: Patch[],
): { text: string; changed: { path: string; from: unknown; to: unknown }[] };
export function loadInfraConfig(raw: unknown): InfraConfig;
export function hasDomain(cfg: InfraConfig): boolean;
export function extractJson(stdout: string): unknown;
export function parseD1List(stdout: string): Map<string, string>;
export function parseKvList(stdout: string): Map<string, string>;
export function parseR2List(stdout: string): Set<string>;
export function parseGatewayList(body: unknown): Set<string>;
export function parseSecretNames(stdout: string): Set<string>;
export function parseWhoamiAccounts(stdout: string): { id: string; name: string }[];
export function desiredResources(cfg: InfraConfig): Resource[];
export function planResources(
  desired: Resource[],
  existing: {
    d1: Map<string, string>;
    kv: Map<string, string>;
    r2: Set<string>;
    aiGateway: Set<string> | null;
  },
): PlanItem[];
export function formatPlan(plan: PlanItem[]): string[];
export function buildPatches(
  wrangler: unknown,
  migrations: unknown,
  cfg: InfraConfig,
  ids: ResolvedIds,
): { wrangler: Patch[]; migrations: Patch[] };
export function isPlaceholderId(id: unknown): boolean;
export function checkDeployConfig(
  target: Target,
  wrangler: unknown,
  migrations: unknown,
  cfg: InfraConfig,
): { problems: string[]; warnings: string[] };
export function secretCommands(
  cfg: InfraConfig,
  missing: { production?: string[]; previews?: string[] },
): string[];
