// Test-only entrypoint. Never referenced by the deployed Worker configuration.
import type { JevControl } from '../../src/jev/control.ts';

export { JevControl } from '../../src/jev/control.ts';
export default {
  async fetch(request: Request, env: { JEV_CONTROL: DurableObjectNamespace<JevControl> }) {
    const url = new URL(request.url);
    const result = await env.JEV_CONTROL.get(env.JEV_CONTROL.idFromName('jev-admin-v1')).operation(
      request.method,
      url.pathname,
      url.search,
      request.method === 'POST' ? await request.json() : undefined,
      'runtime-test',
    );
    return Response.json(result.data, { status: result.status });
  },
};
