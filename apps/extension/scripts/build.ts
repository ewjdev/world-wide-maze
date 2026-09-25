/**
 * Build the extension: `pnpm --filter @wwm/extension build [--origin https://game.example] [--firefox]`.
 *
 * Output (gitignored):
 *   dist/chrome/                             the unpacked extension (chrome://extensions → Load unpacked)
 *   dist/wwm-maze-this-page-<version>.zip    the same files, zipped for the Chrome Web Store (not uploaded)
 *   dist/firefox/                            with --firefox: the same code with a Firefox manifest (untested)
 *
 * The game origin comes from `--origin`, else `WWM_GAME_ORIGIN`, else the local dev server
 * (http://localhost:5173). It is baked in as the default and is the only host permission the extension holds.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { DEV_ORIGIN, originPattern, parseOrigin } from '../src/config.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

// ── icons: the four colour-role islands, drawn procedurally (no binary assets in the repo) ──

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function icon(size: number): Buffer {
  const px = new Uint8Array(size * size * 4);
  const colors: [number, number, number][] = [
    [0xe0, 0x52, 0x4f], // red
    [0x3f, 0x9a, 0x4c], // green
    [0x4f, 0x9f, 0xd6], // blue
    [0xf2, 0xc2, 0x30], // yellow
  ];
  const pad = Math.max(1, Math.round(size * 0.06));
  const gap = Math.max(1, Math.round(size * 0.07));
  const cell = (size - 2 * pad - gap) / 2;
  const cut = cell * 0.24;
  const SS = 4; // supersampling for smooth chamfers
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - pad;
          const fy = y + (sy + 0.5) / SS - pad;
          const col = fx < cell ? 0 : fx >= cell + gap ? 1 : -1;
          const row = fy < cell ? 0 : fy >= cell + gap ? 1 : -1;
          if (col < 0 || row < 0) continue;
          const u = fx - col * (cell + gap);
          const v = fy - row * (cell + gap);
          if (u >= cell || v >= cell || u + v < cut || cell - u + (cell - v) < cut) continue;
          const [cr, cg, cb] = colors[row * 2 + col] as [number, number, number];
          const shade = v > cell * 0.8 ? 0.78 : 1; // the island's slab edge
          r += cr * shade;
          g += cg * shade;
          b += cb * shade;
          a++;
        }
      const i = (y * size + x) * 4;
      if (a > 0) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((255 * a) / (SS * SS));
    }
  return png(size, size, px);
}

// ── zip (deflate, no dependencies) ──

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const DOS_TIME = 0; // fixed timestamps: reproducible archives
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(8, 8); // deflate
    h.writeUInt16LE(DOS_TIME, 10);
    h.writeUInt16LE(DOS_DATE, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26);
    local.push(h, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(DOS_TIME, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// ── manifest ──

const LOOPBACK_PATTERNS = ['http://localhost/*', 'http://127.0.0.1/*'];

export function manifest(origin: string, target: 'chrome' | 'firefox') {
  const loopback = LOOPBACK_PATTERNS.includes(originPattern(origin));
  const icons = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };
  return {
    manifest_version: 3,
    name: 'World Wide Maze: Maze this page',
    short_name: 'Maze this page',
    version: pkg.version,
    description:
      'Turn the page you’re on into a 3D marble maze. Built in your browser; nothing is uploaded unless you share.',
    icons,
    action: { default_popup: 'popup.html', default_title: 'Maze this page', default_icon: icons },
    background:
      target === 'chrome'
        ? { service_worker: 'background.js', type: 'module' }
        : { scripts: ['background.js'], type: 'module' },
    // activeTab: the page you click on, only then. scripting: read it and hand it to the game tab.
    permissions: ['activeTab', 'scripting'],
    // The game's own address (the handoff target), and nothing else.
    host_permissions: loopback ? LOOPBACK_PATTERNS : [originPattern(origin)],
    // Only if the player points the extension at another game address (asked at that moment).
    optional_host_permissions: ['https://*/*', ...LOOPBACK_PATTERNS],
    ...(target === 'chrome'
      ? { minimum_chrome_version: '116' }
      : {
          browser_specific_settings: {
            gecko: { id: 'maze-this-page@worldwidemaze.invalid', strict_min_version: '128.0' },
          },
        }),
  };
}

// ── build ──

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function buildExtension(
  opts: { origin?: string; outDir?: string; firefox?: boolean; zip?: boolean } = {},
) {
  const origin = parseOrigin(opts.origin ?? process.env.WWM_GAME_ORIGIN ?? DEV_ORIGIN);
  if (!origin) throw new Error(`not a usable game origin: ${opts.origin ?? process.env.WWM_GAME_ORIGIN}`);
  const dist = resolve(opts.outDir ?? join(ROOT, 'dist'));
  const targets: ('chrome' | 'firefox')[] = opts.firefox ? ['chrome', 'firefox'] : ['chrome'];
  const require = createRequire(import.meta.url);
  const fontFile = (pkgName: string, file: string) =>
    join(dirname(require.resolve(`${pkgName}/package.json`)), 'files', file);

  for (const target of targets) {
    const out = join(dist, target);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'icons'), { recursive: true });
    mkdirSync(join(out, 'fonts'), { recursive: true });
    const common = {
      bundle: true,
      platform: 'browser' as const,
      target: target === 'chrome' ? 'chrome116' : 'firefox128',
      define: { __WWM_GAME_ORIGIN__: JSON.stringify(origin) },
      legalComments: 'none' as const,
      // Minified, not obfuscated (store policy); the sources are in the repo. The injected page functions
      // stay self-contained because esbuild never hoists code out of a function body.
      minify: true,
      keepNames: false,
      logLevel: 'warning' as const,
    };
    await build({
      ...common,
      entryPoints: [join(ROOT, 'src/background.ts')],
      format: 'esm',
      outfile: join(out, 'background.js'),
    });
    await build({
      ...common,
      entryPoints: [join(ROOT, 'src/popup.ts')],
      format: 'iife',
      outfile: join(out, 'popup.js'),
    });
    copyFileSync(join(ROOT, 'static/popup.html'), join(out, 'popup.html'));
    copyFileSync(join(ROOT, 'static/popup.css'), join(out, 'popup.css'));
    copyFileSync(
      fontFile('@fontsource-variable/unbounded', 'unbounded-latin-wght-normal.woff2'),
      join(out, 'fonts/unbounded-latin-wght-normal.woff2'),
    );
    copyFileSync(
      fontFile('@fontsource-variable/figtree', 'figtree-latin-wght-normal.woff2'),
      join(out, 'fonts/figtree-latin-wght-normal.woff2'),
    );
    for (const s of [16, 32, 48, 128]) writeFileSync(join(out, `icons/${s}.png`), icon(s));
    writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest(origin, target), null, 2)}\n`);
  }

  let zipPath: string | null = null;
  if (opts.zip !== false) {
    const out = join(dist, 'chrome');
    const names = [
      'manifest.json',
      'background.js',
      'popup.html',
      'popup.css',
      'popup.js',
      'fonts/unbounded-latin-wght-normal.woff2',
      'fonts/figtree-latin-wght-normal.woff2',
      ...[16, 32, 48, 128].map((s) => `icons/${s}.png`),
    ];
    zipPath = join(dist, `wwm-maze-this-page-${pkg.version}.zip`);
    writeFileSync(zipPath, zip(names.map((name) => ({ name, data: readFileSync(join(out, name)) }))));
  }
  return { origin, dir: join(dist, 'chrome'), zip: zipPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await buildExtension({
    ...(arg('--origin') ? { origin: arg('--origin') } : {}),
    ...(arg('--out') ? { outDir: arg('--out') } : {}),
    firefox: process.argv.includes('--firefox'),
  });
  console.log(`game origin: ${r.origin}`);
  console.log(`unpacked:    ${relative(process.cwd(), r.dir)}`);
  if (r.zip) console.log(`zip:         ${relative(process.cwd(), r.zip)}`);
}
