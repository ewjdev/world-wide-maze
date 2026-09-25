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
 *
 * Running it again stops the previous instance first (found via `.dev-phone.pid`), and clears dev servers
 * left on the web/worker ports — but only processes started from this repo; anything else is reported and
 * left alone.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIDFILE = join(ROOT, '.dev-phone.pid');
const PORTS = [5173, 8787]; // Vite (web) and wrangler (worker, fixed --port in apps/worker)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};
const cwdOf = (pid) => sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).match(/^n(.*)$/m)?.[1] ?? '';
const commandOf = (pid) => sh('ps', ['-o', 'command=', '-p', String(pid)]).trim();

/** Stop a process (and its process group if it leads one), escalating to SIGKILL after `ms`. */
async function stop(pid, ms = 8000) {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGINT');
    } catch {}
  }
  for (let t = 0; t < ms && alive(pid); t += 200) await sleep(200);
  if (alive(pid)) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {}
    }
  }
}

/** 1) A previous `pnpm dev:phone` (its children share its process group, so this stops them too). */
async function stopPreviousInstance() {
  if (!existsSync(PIDFILE)) return;
  const pid = Number(readFileSync(PIDFILE, 'utf8'));
  if (pid && pid !== process.pid && alive(pid) && commandOf(pid).includes('dev-phone.mjs')) {
    console.log(`[dev:phone] stopping the previous instance (pid ${pid})…`);
    await stop(pid);
  }
  rmSync(PIDFILE, { force: true });
}

/** 2) Leftover dev servers on our ports — only if they were started from this repo. */
async function clearPorts() {
  const foreign = [];
  for (const port of PORTS) {
    const pids = sh('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'])
      .split('\n')
      .filter(Boolean)
      .map(Number);
    for (const pid of pids) {
      if (cwdOf(pid).startsWith(ROOT)) {
        console.log(`[dev:phone] stopping a leftover dev server on :${port} (pid ${pid})…`);
        await stop(pid, 4000);
      } else foreign.push(`  :${port}  pid ${pid}  ${commandOf(pid).slice(0, 100)}`);
    }
  }
  if (foreign.length) {
    console.error(
      `[dev:phone] these ports are used by processes outside this repo, which I won't stop:\n${foreign.join('\n')}\n` +
        'Stop them yourself, then run `pnpm dev:phone` again.',
    );
    process.exit(1);
  }
}

const children = [];
const recent = []; // last lines of child output, shown if something fails
let shuttingDown = false;

function run(cmd, args, opts = {}) {
  // detached: each child leads its own process group, so shutdown also stops grandchildren (vite, workerd).
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  children.push(child);
  const keep = (buf) => {
    for (const line of buf.toString().split('\n')) if (line.trim()) recent.push(`${cmd}: ${line}`);
    recent.splice(0, Math.max(0, recent.length - 30));
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\n[dev:phone] ${cmd} exited (${code}). Last output:\n${recent.join('\n')}\n`);
      shutdown(1);
    }
  });
  return child;
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all(children.filter((c) => c.exitCode === null).map((c) => stop(c.pid, 5000)));
  rmSync(PIDFILE, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
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

await stopPreviousInstance();
await clearPorts();
writeFileSync(PIDFILE, String(process.pid));

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
