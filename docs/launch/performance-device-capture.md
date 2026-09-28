# Opt-in physical-device evidence capture

This fills the collection gap in [the device matrix](performance-device-matrix.md): Safari and a real phone can export browser evidence without desktop CDP or Metal tools. It does **not** choose minimum hardware, certify self-reported identity, prove GPU utilization, or accept a performance budget. Issue #27 stays open until real devices and acceptance criteria are agreed and exercised. [Regression gates](performance-regression.md) remain separate.

## Prepare a source-bound local build

From the exact checkout being tested:

```sh
node infra/perf/p1-build.mjs
node infra/perf/device-server.mjs
```

Open `http://127.0.0.1:4328/__device/`. The server defaults to loopback. It verifies every production asset against the build manifest and current runtime fingerprint, then pins that verified snapshot in memory. It injects the collector only into this preview's entry HTML and disables analytics locally. Original and instrumented HTML hashes, build manifest hash, runtime hash, and collector hash are exported separately. No product source, production deployment, analytics endpoint, or `dist` file is changed. Responses use `no-store`; start measurement after warm-up. This is not a cold-load benchmark.

For a phone, an operator must explicitly choose an already trusted network/HTTPS setup. `--host=0.0.0.0` opts into LAN listening; this tool does not expose a server, open a tunnel, install certificates, or provision a device automatically. LAN HTTP is insufficient for secure-context motion sensors. Use the same trusted HTTPS origin for the controller and relay. An existing local Worker can be proxied with `--api=http://127.0.0.1:8787`; HTTP API and WebSocket forwarding are then enabled. Without it, API requests return 503 and pairing cannot complete. The proxy's WebSocket upstream must be HTTP, normally the existing local Worker behind the trusted HTTPS frontend. Nothing starts the Worker for you.

## Collect and export

1. Enter the actual model, OS/browser versions, operator, power/network/cache conditions, role and explicit input/stage protocol. Physical identity is self-reported. Supply an independent reviewer/photo/video reference without serial numbers; that reference alone cannot certify identity. Mark automated/emulated trials honestly.
2. Open the game or controller path. A pairing fragment is used only for navigation; it is not exported. Use the same origin and real phone pairing flow. Select `title`, `paused`, `steady-play`, `adaptation`, `lifecycle`, `hidden`, `thermal`, or `controller` to match the protocol. Wait until the relevant phase is ready, then press **Start**.
3. Use the same stage, input route, viewport, DPR, browser, power conditions, warm-up and collector revision in baseline/candidate trials. Alternate order and repeat. Keep the capture panel and diagnostic overhead identical in both arms. A lifecycle run must contain observed phase changes. A hidden run must actually background the document. A thermal game run requires at least 15 visible minutes with observed active play in every full minute and at least 90% of visible snapshots in active play; backgrounded or idle-only windows remain incomplete. This 90% condition describes workload coverage, not an accepted device performance budget. The capture does not force play state, inputs, timers, tiers, device settings, or sensor permissions.
4. Capture stops at the requested duration (5–1800 seconds), on **Stop**, or at its bounded sample limit. Add end battery/thermal observations and press **Export JSON**. Export before navigating away: raw data lives only in this tab. The server receives no evidence upload.
5. Save the exact `performance-build.json` alongside the export and the independent physical evidence. Validate:

```sh
node infra/perf/device-validate.mjs /path/to/report.json /path/to/performance-build.json
```

The optional manifest binds a historical build; otherwise current runtime source is expected. The current collector revision must match. Exit **1** means invalid/contradictory evidence; **2** means incomplete; **3** means structurally complete but **manual review required**. There is deliberately no exit-0 physical-acceptance result. Do not use this command as an automatic merge/performance-pass gate. An expected manifest identifies a build, not independently verified hardware. Inspect provenance, physical evidence, scenario execution and accepted budgets together.

## What the export means

Raw browser-rAF rows and engine-call rows are separate, with explicit columns and `-1` for an unavailable initial interval/adaptive delta. Submitted engine calls are not hardware-presented frames. Once-per-second snapshots include actual visibility/phase, backend, quality tier/history, viewport/canvas dimensions, renderer retained resource counters where available, optional Chromium heap estimate, and controller diagnostics. Minute windows preserve frame distributions and endpoint snapshots for sustained trends. Visible coverage gaps, missing metrics, errors, contradictory visibility/phase and truncated capture prevent completeness. Browser background throttling can make hidden snapshots sparse; the visibility record preserves that fact.

CPU utilization, GPU utilization/residency/timestamps, worker memory and input-to-photon latency are unavailable here. Attach OS/GPU profiling or high-speed input/display measurements separately. Engine method wall time is neither total CPU time nor GPU work; renderer counters are retained estimates, not total device memory. Controller RTT is a network round trip, not input-to-photon latency. Safari may lack long-task and heap APIs; exports preserve `null`, never zero. Real iOS/Safari and Android device acceptance is still untested.

Instrumentation adds a small fixed panel, two bounded chunked typed-array streams, a frame wrapper and one-second snapshots. At 60 Hz, 15 minutes of both streams use about 3.5 MiB of numeric payload; caps are 240,000 rows per stream. JSON materialization/download happens after timing stops and can have a temporary memory peak. Resource/heap comparisons must account for collector storage growth; do not label that growth a game leak. The tool does not assert that its overhead is negligible.

## Tool checks

```sh
node --test infra/perf/device-data.test.mjs infra/perf/device-server.test.mjs
# Requires source-bound build and an exclusive performance-test host:
DEVICE_SMOKE_OUT=/tmp/device-smoke.json node --test infra/perf/device-browser.test.mjs
pnpm check
```

The automated Chromium smoke disables the optional long-task API to exercise the portable path, checks real frame/resource collection and hook restoration, and verifies JSON download. It is explicitly automated evidence, never a physical-phone or Safari test.
