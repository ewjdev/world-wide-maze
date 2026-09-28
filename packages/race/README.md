# Race domain v1

Shared with the web Race session and its isolated replay worker. Original's goal sensor, score, life
budget and timer do not participate in this domain.

- `RaceCourse` wraps immutable `StageData`, ordered finite directional `RaceGate`s and a content ID.
- `createProgress`, `markPractice`, and `advanceProgress` operate on contiguous completed physics ticks.
  Feed every physical step, including catch-up steps. Set `fell` before finish eligibility is assessed.
  A finish before required sectors remains armed. Forward crossings use `previous < 0 && current >= 0`.
- `RaceRecorder` stores exact consumed JavaScript doubles in 25-byte binary samples (three little-endian
  float64s and one power/jump flag byte). Tick N consumes sample N-1. Default caps are 72,000 ticks,
  8 MiB input/event accounting, and 4,096 recoveries; sample storage uses 1,024-sample chunks.
- Before recovery step N, call `recorder.recover({beforeTick:N,destination,reason})`, reset the simulation
  using the destination in **stage pixels**, and rebase the observer's previous state. Recovery teleports
  must never be submitted as physical crossing segments. No automatic legacy replay reset is used.
- `recorder.record(input)` returns false after the cap. Preserve its complete prefix, mark progress
  practice with `recording-limit`, and allow physical play to continue. Finishing on the last fully
  recorded tick remains eligible. `finish()` returns a detached copy suitable for durable storage.
- `makeCompatibility(courseId)` freezes rules, 120 Hz, physics version and all resolved default physics
  parameters. Course construction owns the content ID; it must include geometry, gates, seed, versions
  and texture identity. A differing compatibility key is never a comparable best or playable ghost.
- `validateAttempt` checks structural and allocation bounds. It does not prove physical completion.
  `replayRace` reruns real physics and verifies sector/finish ticks; ordinary physics goal events are
  ignored. Session-only pause/focus/controller eligibility reasons cannot be reconstructed from inputs.
- `RaceGhostTrack` has initial pose at index zero and completed tick N at index N. `sampleRaceTrack`
  accepts a fractional simulation tick and stops after the recorded prefix. It holds the old pose before
  a recovery and snaps at the recovered tick; it never interpolates across the teleport.

At the maximum duration, inputs occupy 1,800,000 bytes and a derived pose track 2,088,029 bytes. Two
maximum tracks use 4,176,058 bytes, below the separate 8 MiB pose budget. These are exact typed-buffer
sizes; browser heap, Rapier world, rendering and device performance require independent measurement.

The web `RaceHistory` adapter uses IndexedDB database `wwm-race-history` version 1, with atomic
`attempts` and `bests` stores. It serializes concurrent writers, keeps ten recent compatible attempts
plus a protected best, and enforces a 50 MiB estimated persisted-byte budget. Ties preserve the existing
best index. A failed write leaves the current result available to the caller and, within the same
budget, in session memory. Unsupported/malformed records are ignored, never reinterpreted or uploaded.

The web `GhostClient` runs one dedicated worker at a time. Starting another preparation or calling
`cancel` terminates the previous worker, rejects its promise with `AbortError`, and rejects stale
completion callbacks. Callers own at most two retained tracks and must dispose ghosts and client on exit.

## Stunt rules v2

Optional `RaceCourse.stunts` opts a course into the shared `createRaceSimulation(course)` wrapper.
Live play and `replayRace` must use that same wrapper. Without stunts the step result is passed directly
through from the unchanged physics simulation, and existing rules/input v1 remain compatible.

Use `makeCompatibility(courseId, true)` and `new RaceRecorder(undefined, true)` for stunt courses.
Input v2 retains the 25-byte layout and uses flag mask 4 for `RaceInputSample.turbo`; masks 1 and 2 remain
power and jump. Unknown flag bits are rejected. Course content IDs must include all stunt parameters.
The rules version prevents a v1 ghost from being treated as a v2 best.

Momentum charges on grounded ticks at >=90% of the authored cruise speed, while advancing the previous
furthest projection toward the next required gate. Slowing, retracing, or a >=3 m/s bump clears unearned
charge. Airborne ticks pause it. A full charge banks one turbo. A rising-edge turbo applies a horizontal
velocity delta in the current direction, capped at the authored maximum, and starts a 120-tick recharge
lockout. A press with no possible impulse retains the banked charge. It never alters angular velocity.

Crossing a designated directional launch gate while touching its approach and above minimum speed
applies the authored upward velocity floor once per pad per run. First contact after >=0.15s airborne
and >=2m forward travel awards the modest landing impulse only on a configured island distinct from
the launch island, with forward heading and no hard bump. Invalid first contacts end that flight's
provenance. Recovery clears charge and flight provenance but retains consumed pads and progress high
water; loading a new run resets all mechanics. `getMechanics()` returns a snapshot, with `lastEvent`
available for precisely one simulation tick; capture it in the per-step UI observer.

`validateStunts` rejects nonfinite/out-of-range tuning, malformed launch gates, duplicate pad IDs and
unknown landing island IDs before creating Rapier. The additive physics `applyVelocityDelta` API is
bounded and never resets contact, fall, rotation or position state. Normal race/original physics does
not invoke it.
