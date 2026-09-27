import { DurableObject } from 'cloudflare:workers';
import { JevService } from '../../../../tools/jev-runtime/src/service.ts';
import { CloudJevArchive } from './archive.ts';
import { JevBudget, RESERVATION_MICROS } from './budget.ts';

/** Only the authenticated admin router can address this singleton. */
export class JevControl extends DurableObject<Env & { TYPESAFE_API_KEY?: string }> {
  private budget: JevBudget;
  private archive: CloudJevArchive;
  private service: JevService<CloudJevArchive>;
  constructor(ctx: DurableObjectState, env: Env & { TYPESAFE_API_KEY?: string }) {
    super(ctx, env);
    let depth = 0;
    const transaction = <T>(fn: () => T): T => {
      if (depth) return fn();
      depth++;
      try {
        return ctx.storage.transactionSync(fn);
      } finally {
        depth--;
      }
    };
    this.budget = new JevBudget(ctx.storage.sql, transaction);
    this.archive = new CloudJevArchive(ctx.storage.sql, transaction, this.budget);
    this.service = new JevService(
      this.archive,
      env.TYPESAFE_API_KEY,
      async (input, init) => {
        this.saveOwners();
        // The reservation must reach durable storage before any billable request leaves this object.
        await this.ctx.storage.sync();
        return fetch(input, init);
      },
      (runId, receipt) => {
        if (receipt.usage) this.budget.settle(runId, receipt.attemptId, receipt.usage.input_tokens);
      },
    );
    const owners = ctx.storage.sql
      .exec<{ body: string }>('SELECT body FROM jev_owners WHERE id=1')
      .toArray()[0];
    if (owners) this.service.owners = new Map(JSON.parse(owners.body));
  }
  private saveOwners() {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO jev_owners VALUES(1,?)',
      JSON.stringify([...this.service.owners]),
    );
  }
  private availability() {
    const budget = this.budget.snapshot();
    return {
      ...this.service.availability(),
      configured: !!this.env.TYPESAFE_API_KEY,
      available:
        !!this.env.TYPESAFE_API_KEY && budget.enabled && budget.remainingMicros >= RESERVATION_MICROS,
      budget,
    };
  }
  async operation(method: string, path: string, query: string, value: unknown, actor: string) {
    try {
      this.service.sweep();
      const q = new URLSearchParams(query);
      if (path === '/settings' && method === 'GET') return { status: 200, data: this.availability() };
      if (path === '/settings' && method === 'POST') {
        this.budget.configure(value, actor);
        return { status: 200, data: this.availability() };
      }
      if (path === '/session' && method === 'GET')
        return { status: 200, data: { token: 'admin', ...this.availability() } };
      if (path === '/runs' && method === 'POST') return { status: 201, data: this.service.create(value) };
      if (path === '/best' && method === 'GET') {
        const best =
          this.archive
            .list()
            .filter(
              (r) =>
                r.fixtureHash === q.get('hash') &&
                r.scoreMode &&
                r.policy === 'jev' &&
                r.status === 'finished',
            )
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
        return { status: 200, data: { best } };
      }
      if (path === '/runs' && method === 'GET') {
        const search = (q.get('q') ?? '').slice(0, 100).toLowerCase();
        const offset = Math.max(0, Math.min(100000, Number(q.get('offset')) || 0));
        const all = this.archive
          .list()
          .filter((r) =>
            [r.id, r.fixture, r.title, r.url, r.policy, r.model, r.status, r.createdAt]
              .join(' ')
              .toLowerCase()
              .includes(search),
          );
        return {
          status: 200,
          data: { runs: all.slice(offset, offset + 20), total: all.length, ...this.availability() },
        };
      }
      const match = path.match(/^\/runs\/([a-f0-9-]{36})(?:\/(command|decide))?$/);
      if (match) {
        const [, id, action] = match;
        if (method === 'GET' && !action) return { status: 200, data: this.archive.detail(id) };
        if (method === 'POST' && action === 'command')
          return { status: 200, data: this.service.command(id, value) };
        if (method === 'POST' && action === 'decide')
          return { status: 200, data: await this.service.decide(id, value) };
      }
      return { status: 404, data: { error: 'Unknown endpoint' } };
    } catch (error) {
      return {
        status: 400,
        data: {
          error: (error instanceof Error ? error.message : 'Jev operation failed')
            .replaceAll(this.env.TYPESAFE_API_KEY || '__no_key__', '[redacted]')
            .slice(0, 300),
        },
      };
    } finally {
      this.saveOwners();
    }
  }
}
