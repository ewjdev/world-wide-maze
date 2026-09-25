#!/usr/bin/env node
/**
 * `pnpm dev:phone` — run the game locally and reach it from a phone.
 *
 * Phones need HTTPS for tilt (iOS only grants motion access on secure origins), so a LAN
 * `http://192.168…` address is not enough. This starts `pnpm dev` (web + worker), opens a
 * Cloudflare quick tunnel (`https://<random>.trycloudflare.com`) to the web server, and opens the
 * game on this computer THROUGH the tunnel — the pairing QR code shown by the game is built from the
 * page's own address, so scanning it sends the phone to the same tunnel.
 *
 * Requires `cloudflared` (`brew install cloudflared`). No Cloudflare account needed. Ctrl-C stops all.
 */
import { spawn, spawnSync } from 'node:child_process';

const children = [];
let shuttingDown = false;

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\n[dev:phone] ${cmd} exited (${code}). Stopping.`);
      shutdown(1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (e) => {
  console.error(`[dev:phone] ${e instanceof Error ? e.message : e}`);
  shutdown(1);
});

/** Resolve with the first regex match found in a child's output (stdout + stderr). */
function waitFor(child, re, label, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
    const onData = (buf) => {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colour codes
      const text = buf.toString().replace(/\u001b\[[0-9;]*m/g, '');
      if (process.env.DEV_PHONE_VERBOSE) process.stdout.write(text);
      const m = text.match(re);
      if (m) {
        clearTimeout(timer);
        resolve(m);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('[dev:phone] cloudflared not found. Install it with:  brew install cloudflared');
  process.exit(1);
}

console.log('[dev:phone] starting web + worker (pnpm dev)…');
const dev = run('pnpm', ['dev'], { env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
// Vite prints e.g. "Local:   http://localhost:5173/" (it picks the next free port if 5173 is busy).
const [, port] = await waitFor(dev, /Local:\s+http:\/\/localhost:(\d+)/, 'the web dev server');
await waitFor(dev, /Ready on http:\/\/(localhost|127\.0\.0\.1):\d+/, 'the worker dev server', 60_000).catch(
  () => {
    console.warn(
      '[dev:phone] worker did not report ready yet; continuing (API calls may fail until it does).',
    );
  },
);

console.log(`[dev:phone] web on :${port}; opening an HTTPS tunnel…`);
const tunnel = run('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
const [url] = await waitFor(tunnel, /https:\/\/[a-z0-9-]+\.trycloudflare\.com/, 'the tunnel URL');

// Don't look the hostname up locally until the tunnel is registered and public DNS has it: an early lookup
// makes macOS cache "not found" for a while, and the browser then can't open the URL.
await waitFor(tunnel, /Registered tunnel connection/, 'the tunnel to register');
const host = new URL(url).hostname;
for (let i = 0; i < 60; i++) {
  const r = await fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, {
    headers: { accept: 'application/dns-json' },
  })
    .then((res) => res.json())
    .catch(() => null);
  if (r?.Answer?.length) break;
  await new Promise((res) => setTimeout(res, 1000));
}
await new Promise((res) => setTimeout(res, 3000));

console.log(`
  ┌───────────────────────────────────────────────────────────────────────┐
    World Wide Maze is live at:

      ${url}

    1. The game is opening on this computer (use this URL, not localhost,
       so the pairing QR code points at the tunnel).
    2. Click Start, then scan the QR code with your phone's camera.
    3. On the phone: tap "Enable tilt" → Allow, hold still to calibrate.

    Phone-only play: open the URL on the phone directly.
    Ctrl-C to stop everything.
  └───────────────────────────────────────────────────────────────────────┘
`);
if (process.platform === 'darwin') spawnSync('open', [url]);
