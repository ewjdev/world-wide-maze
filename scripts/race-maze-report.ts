import { existsSync } from 'node:fs';
/** Build the local review gallery from final, matching browser/physics evidence. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compatible, makeCompatibility } from '../packages/race/src/index.ts';

const root = resolve(import.meta.dirname, '..'),
  dir = resolve(root, 'fixtures/race');
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const classics = ['flow-sprint', 'switchback', 'longline', 'island-leap'];
const slugs = (await readdir(dir, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && existsSync(resolve(dir, e.name, 'course.json')))
  .map((e) => e.name);
const rows = [];
for (const slug of slugs) {
  const folder = resolve(dir, slug),
    spec = classics.includes(slug)
      ? { number: 11 + classics.indexOf(slug) }
      : await read(resolve(folder, 'maze.json')),
    course = await read(resolve(folder, 'course.json')),
    validation = await read(resolve(folder, 'race-validation.json'));
  if (validation.courseId !== course.courseId) throw Error(`${slug}: stale physics evidence`);
  const expectedCompatibility = makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile);
  for (const run of validation.routes ?? [validation]) {
    if (
      course.physicsProfile &&
      (!run.compatibility || !compatible(run.compatibility, expectedCompatibility))
    )
      throw Error(`${slug}: stale headless physics profile`);
  }
  const browserFiles = (await readdir(folder)).filter((f) =>
    /^(route-\d+|solver|safe|near|far)-browser-validation\.json$/.test(f),
  );
  if (browserFiles.length < (classics.includes(slug) && slug !== 'island-leap' ? 1 : 2))
    throw Error(`${slug}: missing browser runs`);
  const straight = await read(resolve(folder, 'straight-validation.json'));
  if (straight.courseId !== course.courseId || !straight.pass)
    throw Error(`${slug}: stale or failed straight audit`);
  const runs = [];
  for (const f of browserFiles) {
    const b = await read(resolve(folder, f));
    if (b.courseId !== course.courseId || b.pageErrors.length || b.maxPoseError > 1e-5)
      throw Error(`${slug}: stale/failed browser evidence`);
    if (course.physicsProfile && (!b.compatibility || !compatible(b.compatibility, expectedCompatibility)))
      throw Error(`${slug}: stale browser physics profile`);
    runs.push(b);
  }
  const screenshots = runs.flatMap((b) => b.screenshots);
  for (const extra of ['bank-browser-validation.json', 'layer-browser-validation.json']) {
    try {
      const evidence = await read(resolve(folder, extra));
      if (evidence.courseId !== course.courseId) throw Error(`${slug}: stale supplemental capture`);
      if (
        course.physicsProfile &&
        (!evidence.compatibility || !compatible(evidence.compatibility, expectedCompatibility))
      )
        throw Error(`${slug}: stale supplemental physics profile`);
      if (
        evidence.pageErrors?.length ||
        (evidence.maxPoseError ?? 0) > 1e-5 ||
        evidence.captures?.some((capture: { maxPoseError?: number }) => (capture.maxPoseError ?? 0) > 1e-5)
      )
        throw Error(`${slug}: failed supplemental capture`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const file of await readdir(resolve(folder, 'screenshots'))) {
    const path = `screenshots/${file}`;
    if (file.endsWith('.png') && !screenshots.includes(path)) screenshots.push(path);
  }
  rows.push({
    slug,
    number: spec.number,
    title: course.title,
    courseId: course.courseId,
    routes: (validation.routes ?? [{ route: 'solver', progress: validation.progress }]).map(
      (r: { route: string; progress: { finishTick: number } }) => ({
        route: r.route,
        seconds: r.progress.finishTick / 120,
      }),
    ),
    longStraights: straight.longStraights.length,
    longStraightThresholdMetres: straight.limitMetres,
    screenshots,
    browserRuns: runs.length,
  });
}
rows.sort((a, b) => a.number - b.number);
const esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Race maze verification</title><style>body{margin:0;background:#142331;color:#eef5f6;font:16px/1.6 system-ui}main{max-width:1200px;margin:auto;padding:36px 24px}h1{font-size:42px;line-height:1.1}h2{margin-top:64px}a{color:#a5e4d7}nav{display:flex;gap:16px;flex-wrap:wrap}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}img{width:100%;border-radius:8px}figure{margin:0}figcaption,code{font-size:12px;color:#bdd1db}p{max-width:850px}.times{padding:14px;background:#203747;border-radius:8px}</style><main><h1>Fourteen race courses<br>Elevation, momentum & turbo</h1><p>All fourteen courses pass the long-straight audit and real Rapier runs with independent replay checks. The ten new mazes have at least two browser runs each; the earlier ground courses each have a browser run, and Island Leap has ground and leap runs. Screenshots below are unedited browser captures. The ten maze courses retain their different islands, curved ramps and gaps. Turbo banks one charge per uninterrupted three seconds at qualifying grounded speed. Descending and airborne travel reset partial charge; stored charges remain available. Terrain momentum can reach a 48 m/s horizontal ceiling. Each fall removes one charge and one of three lives; retry begins a fresh attempt.</p><p>These results establish clean traversal and rendering. A long straight exceeds three seconds at that course’s cruise speed before accumulating 20° of heading change. The audit includes authored routes and catch returns, not every possible shortcut. The runs do not establish human difficulty, optimal turbo strategy or general missed-jump recovery. Sky Weave remains longer than the roughly 60-second target; most other maze routes are about a minute. See each course review for specific limits.</p><div class="shots"><figure><img loading="lazy" src="turbo-lives-mobile.png" alt="Mobile race HUD with turbo stock and lives"><figcaption>Turbo inventory and lives</figcaption></figure><figure><img loading="lazy" src="out-of-lives-mobile.png" alt="Out of lives after three physical falls"><figcaption>Three falls end the attempt</figcaption></figure><figure><img loading="lazy" src="phone-turbo-stack.png" alt="Phone turbo controls"><figcaption>Phone controller</figcaption></figure></div><nav>${rows.map((r) => `<a href="#${r.slug}">${r.number}. ${esc(r.title)}</a>`).join('')}</nav>${rows.map((r) => `<section id="${r.slug}"><h2>${r.number}. ${esc(r.title)}</h2><p><a href="http://127.0.0.1:5214/race/${r.slug}">Play course</a> · <a href="${r.slug}/review.md">Detailed review</a> · <a href="${r.slug}/race-validation.json">Physics evidence</a></p><p>${r.longStraights} long straight(s), ${r.longStraightThresholdMetres}m threshold.</p><div class="times">${r.routes.map((x) => `${x.route}: ${x.seconds.toFixed(3)}s`).join(' · ')}</div><p><code>${r.courseId}</code></p><div class="shots">${r.screenshots.map((s) => `<figure><a href="${r.slug}/${s}"><img loading="lazy" src="${r.slug}/${s}" alt="${esc(r.title)} ${esc(s)}"></a><figcaption>${esc(s)}</figcaption></figure>`).join('')}</div></section>`).join('')}</main></html>`;
await writeFile(resolve(dir, 'review.html'), html);
await writeFile(
  resolve(dir, 'maze-verification.json'),
  `${JSON.stringify({ courses: rows.length, routeRuns: rows.reduce((n, r) => n + r.routes.length, 0), browserRuns: rows.reduce((n, r) => n + r.browserRuns, 0), coursesEvidence: rows }, null, 2)}\n`,
);
console.log(`Gallery: ${rows.length} courses, ${rows.reduce((n, r) => n + r.routes.length, 0)} routes`);
