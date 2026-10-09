# Home performance evidence — October 9, 2026

Matched baseline: `7b233d54166f4df2abf65542390a4b3663a5906b`, runtime fingerprint `217be01db1ea9098483d1ae0b45505c19c86623e5f0276bdd975eff85c5c4fc5`.

Measured candidate runtime: `58ef36928c1b7646d29ab0403ffff3a46135244e`, fingerprint `a8b7307d846fccd9558660720b0427b98e9214422123ee936f0998aa1af88171`. Later commits change collectors or documentation only. Every accepted headed report verifies the served build manifest and asset hashes before timing. Source/environment gates in `comparison.json` pass.

Read `summary-final.json` for short-window per-trial values and `comparison.json` for the strict comparator. `manifest.json` identifies each losslessly compressed raw report, acceptance status, and hashes of both compressed and original bytes. Frame arrays, long tasks, build assets and allocation counters remain inside the reports; no outlier was removed. Decompress with `gzip -dc <file.json.gz>`.

## Environment and interpretation

- macOS, M5 Max / 64 GiB, headed Chromium 153, native Metal; WebGL2 fallback recorded separately. CPU stress on a powerful GPU does not certify physical weak GPUs.
- Both production builds used `infra/perf/home-serve.mjs`: deterministic gzip level 6 for HTML/JS/CSS/JSON/SVG, WASM uncompressed, hashed assets immutable. Cloudflare HTTP/3, encoding, geography and latency differ. Hosted preview verification is separate.
- Cold and same-context warm reloads are distinct. Each report retains its CDP profiles. Startup's older `real live network` note means actual network requests; the recorded URL is localhost.
- Lighthouse 13.5.0 is a separate headless simulated benchmark. Do not combine it with headed CPU/network measurements or call lab input proxies field INP.
- Native refresh cadence varied around 60–120 Hz. FPS changes alone are not causal evidence. Scene submissions and input rAF callbacks are distinct. GPU timestamps are sampled one in ten scene frames; unsupported/no-frame samples are unavailable. Renderer bytes are estimates, not physical VRAM.
- Three trials per short home runtime/load/control/play case; one minute observation per idle mode; three minute-long Auto CPU6 recovery runs; six minute-long normal-fixture tours per arm; single stress/fallback frame cases; one minute-long replay per CPU level per arm; three Lighthouse runs per preset per arm. Small samples do not establish population tail latency.
- Collection was sequential without parallel local benchmarks/browser/tests. `collection-order.txt` retains final suite order and time. It alternates arms by core mode but is not randomized. The earlier baseline batch is preserved. Interpret desktop first-control differences with run variance and the deferred-loading tradeoff.

## Accepted and retained evidence

`baseline-fixed`, `baseline-control-refresh`, `baseline-core`, `candidate-final`, `candidate-final-recovery`, `candidate-idle60`, `candidate-core`, and both `*-lighthouse` directories are accepted final comparisons. Refreshed baseline control includes pointerdown timing and cold audio, matching the final collector.

Other candidate reports are superseded: initial bloom recovery created 171–204 ms tasks; a no-bloom variant still rebuilt FXAA with a roughly 182 ms task; a later variant needed a Pixel look initialization-race correction; the pre-feedback variant evaluated imports before feedback paint. They do not validate the final runtime. The first `baseline/start-control.json` allocation counter was invalid and is excluded from allocation acceptance; its flag/reason are retained.

`original-live` preserves the initial production audit separately. Its deployed SHA was not established. Do not attribute it to the matched baseline commit or splice its Lighthouse numbers into this comparison.

## Reproduction

Build each arm in a separate checkout, retaining the candidate collectors for both. Copy baseline `apps/web/dist` to an immutable directory before building the candidate. `AUDIT_BASELINE_RECORD` identifies that historical runtime; omit it for the candidate.

```sh
node infra/perf/p1-build.mjs
AUDIT_DIST=/absolute/path/to/baseline-dist AUDIT_PORT=4318 node infra/perf/home-serve.mjs
```

In another terminal, use a fresh output directory:

```sh
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_BASELINE_RECORD=/absolute/path/to/baseline-dist/performance-build.json AUDIT_OUT=/tmp/home-baseline-unique node infra/perf/home-startup.mjs
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_BASELINE_RECORD=/absolute/path/to/baseline-dist/performance-build.json AUDIT_OUT=/tmp/home-baseline-unique node infra/perf/home-start-control.mjs
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_BASELINE_RECORD=/absolute/path/to/baseline-dist/performance-build.json AUDIT_OUT=/tmp/home-baseline-unique node infra/perf/home-runtime.mjs
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_BASELINE_RECORD=/absolute/path/to/baseline-dist/performance-build.json AUDIT_OUT=/tmp/home-baseline-unique node infra/perf/home-play.mjs
```

For candidate collections, use its server URL and omit `AUDIT_BASELINE_RECORD`. Home collectors default to three repeats. `AUDIT_SECONDS=60` selects minute windows and `AUDIT_CASES` comma-separated case names. Retained `run-final-suite.py` records exact settings/order; `summarize.py` records aggregation. Historical orchestration scripts use the original temporary directory; change paths for a new run. Existing report files are refused.

Collect each arm's `audit-2026-09.mjs frames`, `gpu`, `lifecycle`, and `replay`. `AUDIT_TOUR_SECONDS=60` extends six normal fixtures without altering stress/fallback cases. Then:

```sh
node infra/perf/p1-regression.mjs /tmp/baseline-core /tmp/candidate-core /tmp/comparison.json --strict-resource-plateau
AUDIT_BASE=http://127.0.0.1:4328 AUDIT_OUT=/tmp/home-lighthouse-candidate-unique node infra/perf/home-lighthouse.mjs
```

Run sequentially on an otherwise idle machine. Retain rejected runs/errors with reasons. Asset verification deliberately happens before timing.

## Remaining acceptance

Cold native sound unlock exceeded the 100 ms first-feedback target; desktop early-Start-to-play medians also increased. These open budgets appear in the implementation receipt. Physical integrated GPUs, Android/iOS, Safari, connected API/phone pairing and 15-minute thermal play are not established by local or assets-only hosted checks. Eric chooses cached versus 10/15/30 FPS title motion after reviewing feel and readability. Production release is a later action.
