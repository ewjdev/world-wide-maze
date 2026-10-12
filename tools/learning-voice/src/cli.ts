/**
 * `pnpm learning:voice [--write] [--audition] [--verify]`
 *
 * Voices every line of the baseline learning path (`pathScript(selectedPath)`) as Pip:
 * - dry run (default): lists lines whose clip is missing or stale and the characters a `--write` would spend;
 * - `--write`: generates those clips through AI Gateway `wwm` → ElevenLabs `with-timestamps`, stores
 *   `<hash>.mp3` in R2 `wwm-learning-audio` (public at DEFAULT_AUDIO_BASE), and rewrites
 *   packages/learning/src/voice-manifest.json (hashes + word timings; no audio in git);
 * - `--verify`: also checks every manifest clip exists in R2;
 * - `--audition`: voices four sample lines with each candidate voice (voice.config.json) into `audition/` and
 *   writes tools/learning-voice/audition.html to listen and choose.
 *
 * Network access goes through a local `wrangler dev` helper Worker (proxy/), using the developer's wrangler login.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  baselinePath,
  DEFAULT_AUDIO_BASE,
  pathScript,
  rocketPath,
  type ScriptLine,
  type VoiceClip,
} from '@wwm/learning';
import { type Alignment, clipHash, settingsHash, type VoiceConfig, wordTimings } from './timing.ts';

const TOOL = new URL('../', import.meta.url);
const argv = process.argv.slice(2);
const pathFlag = argv.indexOf('--path');
const pathId = pathFlag >= 0 ? argv[pathFlag + 1] : 'little-discoveries';
if (pathId !== 'little-discoveries' && pathId !== 'pip-discoveries')
  throw new Error('Unknown voice path. Use little-discoveries or pip-discoveries.');
const selectedPath = pathId === 'pip-discoveries' ? rocketPath : baselinePath;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--path') {
    i++;
    continue;
  }
  if (!['--write', '--verify', '--audition'].includes(argv[i] ?? ''))
    throw new Error(`Unknown argument: ${argv[i]}`);
}
const MANIFEST = new URL(
  `../../../packages/learning/src/${pathId === 'pip-discoveries' ? 'rocket-voice-manifest' : 'voice-manifest'}.json`,
  import.meta.url,
);
const PORT = 8791;
const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const audition = args.has('--audition');
if (audition && pathId !== 'little-discoveries')
  throw new Error('Voice audition uses the baseline sample. Omit --path.');
const verify = args.has('--verify');
// Explicit opt-in for operator-only paid generation; never retry an ambiguous paid response.
const maxCharacters = Number(process.env.WWM_VOICE_MAX_CHARACTERS ?? 0);
if (
  (write || audition) &&
  (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 10_000)
)
  throw new Error(
    'Set WWM_VOICE_MAX_CHARACTERS=1..10000 after reviewing the dry run and provider allowance.',
  );
let attemptedCharacters = 0;

interface Config extends VoiceConfig {
  voiceName: string;
  audition: { voiceId: string; name: string }[];
}
const config = JSON.parse(await readFile(new URL('voice.config.json', TOOL), 'utf8')) as Config;
const voice = { voiceId: config.voiceId, model: config.model, settings: settingsHash(config) };

let proxy: ChildProcess | null = null;
async function startProxy(): Promise<string> {
  const base = `http://127.0.0.1:${PORT}`;
  proxy = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      'proxy/wrangler.jsonc',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(TOOL),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  proxy.stdout?.on('data', (chunk) => {
    log += chunk;
  });
  proxy.stderr?.on('data', (chunk) => {
    log += chunk;
  });
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`${base}/object/probe.mp3`, { method: 'HEAD' });
      if (response.status === 404 || response.status === 200) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The voice proxy did not start:\n${log.slice(-2000)}`);
}
function stopProxy(): void {
  proxy?.kill('SIGINT');
  proxy = null;
}

async function tts(base: string, text: string, voiceId: string, key: string): Promise<Alignment> {
  attemptedCharacters += text.length;
  if (attemptedCharacters > maxCharacters)
    throw new Error('Voice character allowance exhausted. No further requests sent.');
  {
    const response = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId,
        model: config.model,
        settings: config.settings,
        seed: config.seed,
        key,
      }),
    });
    if (response.ok) return ((await response.json()) as { alignment: Alignment }).alignment;
    const detail = await response.text();
    throw new Error(
      `ElevenLabs via AI Gateway failed (${response.status}) for "${text}": ${detail.slice(0, 400)}`,
    );
  }
}

async function exists(base: string, key: string): Promise<boolean> {
  return (await fetch(`${base}/object/${encodeURIComponent(key)}`, { method: 'HEAD' })).status === 200;
}

async function pool<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
    }),
  );
}

// ── the baseline script ───────────────────────────────────────────────────────────────────────────────────

async function voiceBaseline(): Promise<void> {
  const lines = pathScript(selectedPath);
  const current = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
    voiceId: string;
    model: string;
    settings: string;
    clips: VoiceClip[];
  };
  const sameVoice =
    current.voiceId === voice.voiceId && current.model === voice.model && current.settings === voice.settings;
  const known = new Map<string, VoiceClip>();
  if (sameVoice) for (const clip of current.clips) known.set(clip.hash, clip);
  const todo: { line: ScriptLine; hash: string }[] = [];
  const clips: VoiceClip[] = [];
  for (const line of lines) {
    const hash = clipHash(line.text, voice);
    const clip = known.get(hash);
    if (clip) clips.push({ ...clip, line: line.id, text: line.text });
    else todo.push({ line, hash });
  }
  const unique = [...new Map(todo.map((item) => [item.hash, item])).values()];
  const chars = unique.reduce((sum, item) => sum + item.line.text.length, 0);
  console.log(
    `${lines.length} lines · ${clips.length} up to date · ${todo.length} to voice (${unique.length} unique, ${chars} characters) · voice ${config.voiceName} / ${config.model} / ${voice.settings}`,
  );
  if (!write && !verify) {
    for (const item of todo) console.log(`  missing ${item.line.id}: ${item.line.text}`);
    if (todo.length) console.log('Dry run. Re-run with --write to generate (spends ElevenLabs credits).');
    return;
  }
  const base = await startProxy();
  // progress is kept even if a run is interrupted: finished clips are already in R2
  const made = new Map<string, { ms: number; words: number[] }>();
  let failure: unknown = null;
  try {
    if (verify) {
      const missing: string[] = [];
      await pool(clips, 6, async (clip) => {
        if (!(await exists(base, `${clip.hash}.mp3`))) missing.push(clip.line);
      });
      console.log(
        missing.length ? `Missing in R2: ${missing.join(', ')}` : `All ${clips.length} clips are in R2.`,
      );
    }
    if (write && unique.length) {
      let done = 0;
      await pool(unique, 2, async ({ line, hash }) => {
        const alignment = await tts(base, line.text, voice.voiceId, `${hash}.mp3`);
        made.set(hash, wordTimings(line.text, alignment));
        done++;
        console.log(`  [${done}/${unique.length}] ${line.id}`);
      });
    }
  } catch (error) {
    failure = error;
  } finally {
    stopProxy();
  }
  for (const { line, hash } of todo) {
    const timing = made.get(hash);
    if (timing) clips.push({ line: line.id, text: line.text, hash, ms: timing.ms, words: timing.words });
  }
  if (write) {
    clips.sort((a, b) => a.line.localeCompare(b.line));
    await writeFile(MANIFEST, `${JSON.stringify({ ...voice, clips }, null, 2)}\n`);
    console.log(
      `Wrote ${clips.length} clips to ${fileURLToPath(MANIFEST)}. Audio: ${DEFAULT_AUDIO_BASE}<hash>.mp3`,
    );
  }
  if (failure) throw failure;
}

// ── audition ──────────────────────────────────────────────────────────────────────────────────────────────

async function runAudition(): Promise<void> {
  const byId = new Map(pathScript(selectedPath).map((line) => [line.id, line]));
  const sample = [
    'pip.hello',
    'compare-groups.r1.prompt',
    'compare-groups.r3.match',
    'compare-groups.r4.success',
  ].map((id) => byId.get(id) as ScriptLine);
  const base = await startProxy();
  const rows: string[] = [];
  try {
    for (const candidate of config.audition) {
      const cells: string[] = [];
      for (const [i, line] of sample.entries()) {
        const key = `audition/${candidate.name.toLowerCase()}-${config.model.replace(/_/g, '-')}-${i + 1}.mp3`;
        await tts(base, line.text, candidate.voiceId, key);
        cells.push(
          `<td><p>${line.text}</p><audio controls preload="none" src="${DEFAULT_AUDIO_BASE}${key}"></audio></td>`,
        );
        console.log(`  ${candidate.name} ${i + 1}/${sample.length}`);
      }
      rows.push(
        `<tr><th>${candidate.name}<br><small>${candidate.voiceId}</small></th>${cells.join('')}</tr>`,
      );
    }
  } finally {
    stopProxy();
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Pip voice audition</title><style>body{font:16px system-ui;margin:24px}td,th{border:1px solid #ccc;padding:10px;vertical-align:top}audio{width:220px}</style><h1>Pip voice audition (${config.model})</h1><p>Pick a voice, set <code>voiceId</code> in tools/learning-voice/voice.config.json, then run <code>pnpm learning:voice --write</code>.</p><table>${rows.join('')}</table>\n`;
  await writeFile(new URL('audition.html', TOOL), html);
  console.log(`Wrote ${fileURLToPath(new URL('audition.html', TOOL))}`);
}

try {
  if (audition) await runAudition();
  else await voiceBaseline();
} catch (error) {
  stopProxy();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
