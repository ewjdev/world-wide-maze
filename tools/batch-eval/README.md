# @wwm/batch-eval

This tool measures generator quality across many sites (Phase 09). It runs every capture fixture × slice ×
difficulty × seed through the real builder, `validateStage`, the planner audit and the solver (`@wwm/solver`). The
output is `fixtures/eval/report.json` and a static dashboard, `fixtures/eval/index.html`, with a human rating hook.

## Commands (repo root)
```sh
node tools/batch-eval/src/cli/batch.ts                 # all captures, easy/normal/hard, seeds 1–3 (~30 s, 12 workers)
node tools/batch-eval/src/cli/batch.ts --slugs hn-front,eval-debian --difficulties normal --seeds 1
node tools/batch-eval/src/cli/serve.ts                 # http://localhost:5178: dashboard + rating persistence
node tools/batch-eval/src/cli/shot.ts                  # screenshots → docs/build-log/assets/phase-09/
node tools/batch-eval/src/cli/thumb.ts <slug>[:slice[:difficulty[:seed]]] out.png [--width 1600] [--crop x,y,w,h]
node tools/batch-eval/src/cli/capture-set.ts           # capture any missing page from eval-captures.json (DPR 1)
```
(The same commands are available as `pnpm --filter @wwm/batch-eval batch|serve|shot|thumb|capture`.)

- **batch** writes `report.json`:
  - one record per stage: build ms, counts, validity, the audit, solved/playable, par, falls, jumps, stars, the
    attempts, a classified failure with its island/bridge/elevator IDs and position, solve CPU and the speed-up;
  - aggregates: overall, per difficulty, and fixtures vs the eval-* set;
  - per-run aggregates (a run = every slice of one page for a difficulty and seed): fully playable, plus the
    playable prefix, i.e. what the Worker would publish.
  - Thumbnails are drawn for normal/seed 1 and for every unplayable run, in `fixtures/eval/thumbs/` (gitignored).
- **Dashboard:**
  - KPI tiles, per-difficulty and per-set tables, a par-time histogram against the 150 s rejection line, and
    failure classes;
  - one card per slice: thumbnail, per-seed chips, metrics, failure diagnosis and the **"recognizable? / fun?
    (1–5)" rating plus a note**.
  - Ratings are saved to `fixtures/eval/ratings.json` through `serve` (key `<slug>#<slice>`). When the page is
    opened as a file, they fall back to localStorage, with an "Export ratings.json" button.
- **Thumbnail legend:**
  - islands outlined by height (blue = low, warm = high);
  - bridges light blue, ramps orange, elevators cyan;
  - planned route yellow; ball trace magenta, or red on failure;
  - start green dot, goal gold ring, failure red ring, falls red ×.
  - `thumb --no-solve` adds the nav-grid overlay: green = walkable for the ball centre, red = too close to a wall.

## Eval set (22 captures from Phase 09; plus the 6 Phase 02 fixtures = 28)
All pages were captured on 2026-09-25 (UTC) with `pnpm fixture:capture <url> <slug> --dpr 1 [--dark]`. The sources
are listed in `eval-captures.json`.

**Why DPR 1:**
- The builder's geometry is scale-invariant (Phase 03 test).
- Contracts §9 CCR-07-2 makes the bundle screenshot a 1× analysis image anyway.
- At 2× the set would be about 4× larger.

The eval captures total about 26 MB. `eval-nasa-home` (5.6 MB) is the outlier.

**Licensing:** see `NOTICE.md` at the repo root. Phase 09 originally captured 28 pages; six whose content we had no clear right to redistribute (a news site, a classifieds site, a CSS-framework marketing page, two project home pages and a Google experiments gallery) were removed before publication, together with the Phase 02 news-site fixture. Numbers in older build logs include them.

| Slug | URL | Lang | Layout | Page | License / note |
|---|---|---|---|---|---|
| `eval-aozora-bunko` | https://www.aozora.gr.jp/ | ja | portal / link lists | 1280×3004 | Aozora Bunko: public-domain texts; site chrome by the volunteer project |
| `eval-ja-wikipedia-meiro` | https://ja.wikipedia.org/wiki/迷路 | ja | long article | 1280×6000 | CC BY-SA 4.0 |
| `eval-ja-wikipedia-main` | https://ja.wikipedia.org/wiki/メインページ | ja | portal boxes | 1280×3519 | CC BY-SA 4.0 |
| `eval-digital-go-jp` | https://www.digital.go.jp/ | ja | government landing, cards | 1280×6000 | Japanese Government Standard Terms of Use (CC BY 4.0 compatible) |
| `eval-mdn-ja-dark` | https://developer.mozilla.org/ja/docs/Web/HTML | ja · dark | dark docs | 1280×5707 | CC BY-SA 2.5, Mozilla contributors |
| `eval-github-docs-ja` | https://docs.github.com/ja/get-started/… (redirected to what-is-github) | ja | docs with sidebar | 1280×3139 | CC BY 4.0 (github/docs) |
| `eval-info-cern-first-site` | https://info.cern.ch/hypertext/WWW/TheProject.html | en | sparse 1991 hypertext | 1280×800 | CERN, public-domain release (1993) |
| `eval-sqlite-home` | https://sqlite.org/index.html | en | sparse text + nav | 1280×800 | public domain |
| `eval-gutenberg-alice` | https://www.gutenberg.org/ebooks/11 | en | catalog record, tables | 1280×2234 | Project Gutenberg (public-domain work) |
| `eval-python-home` | https://www.python.org/ | en | marketing grid, dark header band | 1280×2477 | PSF site content |
| `eval-python-docs-tutorial` | https://docs.python.org/3/tutorial/index.html | en | long nested list | 1280×4730 | PSF License (docs) |
| `eval-rust-lang` | https://www.rust-lang.org/ | en | hero + feature sections | 1280×3490 | MIT/Apache-2.0 |
| `eval-go-dev` | https://go.dev/ | en | hero + cards | 1280×3951 | CC BY 4.0 |
| `eval-react-dev-dark` | https://react.dev/ | en · dark | dark marketing, code panels | 1280×6000 | CC BY 4.0 |
| `eval-nasa-home` | https://www.nasa.gov/ | en | image-heavy news grid | 1280×6000 | NASA media, generally public domain (US Gov) |
| `eval-usa-gov` | https://www.usa.gov/ | en | government services cards | 1280×3297 | US Government work, public domain |
| `eval-creativecommons` | https://creativecommons.org/ | en | nonprofit landing | 1280×5940 | CC BY 4.0 |
| `eval-debian` | https://www.debian.org/ | en | classic portal | 1280×2078 | DFSG-free site content |
| `eval-openstreetmap` | https://www.openstreetmap.org/#map=13/35.6812/139.7671 | en | full-viewport map canvas | 1280×800 | ODbL data, CC BY-SA tiles |
| `eval-w3c-home` | https://www.w3.org/ | en | standards org landing | 1280×3510 | W3C Document License |
| `eval-wikipedia-main` | https://en.wikipedia.org/wiki/Main_Page | en | portal boxes | 1280×4235 | CC BY-SA 4.0 |
| `eval-rust-book-dark` | https://doc.rust-lang.org/book/ch01-00-getting-started.html | en · dark | dark book chapter | 1280×800 | MIT/Apache-2.0 |

Pages change. Re-capturing gives different bundles, so the eval numbers belong to this capture date.

## Tests
`pnpm vitest run --project @wwm/batch-eval` checks:
- the eval set: at least 25 captures, and every source is captured and valid;
- the aggregation (`dist`, `group`, `runStats`);
- that the dashboard embeds the data and the rating UI;
- a real `runJob` end to end (example.com);
- the raster primitives.
