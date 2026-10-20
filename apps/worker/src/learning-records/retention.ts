/**
 * Scheduled learning-records cleanup (runs from the Worker's existing cron):
 * - families with no activity for 24 months are deleted completely (FamilyRecords `deleteAll()` and every D1 row);
 * - expired sessions, sign-in links, WebAuthn challenges and pair codes are removed.
 * Runs whatever the gate says, so turning sign-in off never stops the purge. Logs counts only.
 */
import { Accounts, RETENTION_MS } from './accounts.ts';
import { hasBindings } from './config.ts';
import { deleteFamily } from './routes.ts';

const BATCH = 50;
const MAX_BATCHES = 20;

export async function sweepLearningRecords(
  env: Env,
  now = Date.now(),
): Promise<{ families: number; expired: number }> {
  if (!hasBindings(env)) return { families: 0, expired: 0 };
  const accounts = new Accounts(env.LEARNING_DB, () => now);
  let families = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const stale = await accounts.inactiveFamilies(now - RETENTION_MS, BATCH);
    for (const family of stale) {
      await deleteFamily(env, family);
      families++;
    }
    if (stale.length < BATCH) break;
  }
  const expired = await accounts.purgeExpired();
  return { families, expired };
}
