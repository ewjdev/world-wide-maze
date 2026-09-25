# Audio credits

Every sound in the game is **synthesized in code at start-up** by `apps/web/src/audio/audio.ts`
(sine / FM "bell" voices, filtered deterministic noise and a small step sequencer for the music).
There are no sample files, no third-party recordings and **no original 2013 World Wide Maze audio**.

| Cue | 2013 role (E, `sound/soundeffect`) | How it is made here |
|---|---|---|
| BGM `opening` / `game` / `timeup` / `result` / `over` | the five BGM sprites | procedural arpeggio + bass patterns (`TRACKS`), faster minor loop for the last 30 s |
| `item` | small_item | two-note FM blip |
| `large` | large item pickup | rising FM triad + noise shimmer |
| `jump` | jump | sine chirp 320 → 820 Hz |
| `land` | hit_ground (volume ∝ vertical impact²) | low thump + noise, gain `(impact/12)²` |
| `bump` | hit_guardrail (throttled to 500 ms) | short knock, throttled to 500 ms |
| `fall`, `splash` | fall | falling sweep; filtered-noise splash on `lost` |
| `elevator` | goup | rising hum |
| `getGoal`, `goal`, `firework` | get_goal, goal jingle, firework | sweep + bells, 7-note jingle, noise bursts |
| `caution` | caution (last 30 s) | square-wave beeps |
| `point`, `oneup`, `click`, `connected`, `tick`, `go` | point, oneup, click, connected | FM bells |
| rolling loop | rolling (pitched by speed) | looped low-passed noise; rate, cutoff and gain follow ball speed, silent in the air |

License: the synthesis code is part of this repository and shares its license. Generated in 2026 for the
World Wide Maze revival (N).
