/**
 * `pnpm --filter @wwm/worker capture-sidecar` — run the local-Chromium capture sidecar for `wrangler dev`
 * with `CAPTURE_BACKEND=sidecar`. Env: SIDECAR_PORT (default 8788), DEV_ALLOWED_HOSTS, DOH_URL.
 */
import { createDohResolver } from '../src/policy/dns.ts';
import { parseAllowHosts } from '../src/policy/url-policy.ts';
import { LocalChromiumCapturer } from './local-chromium.ts';
import { startCaptureSidecar } from './sidecar.ts';

const capturer = new LocalChromiumCapturer({
  guard: {
    resolver: createDohResolver(process.env.DOH_URL ? { url: process.env.DOH_URL } : {}),
    allowHosts: parseAllowHosts(process.env.DEV_ALLOWED_HOSTS),
  },
});
const sidecar = await startCaptureSidecar({ capturer, port: Number(process.env.SIDECAR_PORT ?? 8788) });
console.log(`capture sidecar on ${sidecar.url} (set CAPTURE_SIDECAR_URL=${sidecar.url})`);
const stop = async () => {
  await sidecar.close();
  await capturer.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
