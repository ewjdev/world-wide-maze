# Progress on this device

Phase 31 M2. A grown-up can see what each child has practised, on the device they play on, with no account. The child's screen stays as it was: Pip, spoken prompts, big tap targets and the hint ladder. See [plans/phase-31-lesson-depth-and-tracking.md](../../plans/phase-31-lesson-depth-and-tracking.md) and the [HTML contract](html-contract.md) (baseline 3.2.0).

## Who's playing

Children are added in **Progress** (`/learn/progress/`, behind a press-and-hold gate). Each child has a nickname and a Pip avatar: Pip in one of six colours, each wearing a different small shape, so a child can tell them apart without reading or relying on colour.

| Children on this device | What the lesson does |
| --- | --- |
| None | Nothing changes. No picker and nothing is saved. |
| One | That child is chosen silently and practice is saved for them. |
| Two or more | Before "Tap Pip to start", a picture-only picker shows each child's Pip. The choice holds for the rest of the visit (the browser tab). A grown-up can change it with **Switch who's playing** under the lesson: press and hold for 2 seconds, or hold G. |

After a child taps their Pip, the browser's own speech synthesis says "Hi, <nickname>!". Nicknames never go through the studio voice (ElevenLabs) or any other provider, and they never appear in evidence.

## What is recorded, and where

One **evidence event** per round the child solves (`LearningEvidence`, `packages/learning/src/evidence.ts`):

- the lesson, objective and round id, and the item's content hash
- whether the item was new to this child, and where it came from (written lesson, bank or generator)
- whether it was solved first try or after a retry, and the highest hint step used (0 none, 1 nudge, 2 strategy, 3 worked example)
- the surface (`lesson`), the way the child answered (tap, letter key, number key or arrows; pressing an answer button from the keyboard or with assistive technology counts as a tap)
- a duration bucket (under 10 s, 30 s or 2 min, or longer) and the time to the minute
- an opaque, random profile id (never the nickname)

The events, the children's profiles and an **outbox** (events not yet sent to an account, for M3) live in this browser's IndexedDB database `wwm-learning-progress` (`createBrowserStore`, `packages/learning/src/browser-store.ts`), on the site's own origin. Each change is one transaction. Nothing is sent over the network: there are no accounts yet, and no analytics call carries any of it.

## What is never recorded

- Names beyond the nickname a grown-up types. The help text asks for a nickname, not a full name. There is no birth date, photo, school or location.
- Anything the child says. There is no microphone, recording or speech recognition, and speaking practice is never scored.
- Wrong answers as a list, free text, tap positions, device details, IP addresses or URLs.
- Maze falls, game scores or anything from the game. The game (M5) will add the same evidence with `surface: 'maze'`, and still no falls or scores.

## What Progress shows

For each child and objective, one state in plain words (the rules are `PROGRESS_RULES`, proposed and pending educator review):

| State | When |
| --- | --- |
| Not tried yet | No rounds saved for it |
| Practising | The latest round was solved first try with at most a nudge |
| Getting there with help | The latest round needed a retry, the strategy or the worked example |
| Got it on new examples | Solved new items first try (at most a nudge) on 2+ items and 2+ days, counted in the family's time zone |

Each objective also shows the day it was last practised and **Try together**, the lesson's idea for away from the screen. Lessons whose rounds have a spoken word model (Spanish and spelling) are labelled **Listening practice**: the child hears and taps, so these show listening, not speaking. The page always says "This shows practice, not a test or a grade." It never shows a percentage, score or ranking.

## Fresh examples

`count-three`, `count-five`, `compare-groups` and `spanish-colors` ask for two fresh examples (`activity.fresh`). Each play-through, the lesson page calls `expandActivity(path, activity, { seed, seen })`, where `seen` holds the item hashes the child playing has already met (empty with no profile). Rounds `fresh-1` and `fresh-2` come after the written rounds and before any bonus. They look and play like any other round and add planks to the bridge. Generators draw them from the play-through's seed, so `?seed=` replays the same draw for the same `seen` set. Fresh rounds have no studio clips, so the browser's voice reads their lines. Without Web Crypto (an insecure origin) the written rounds play and nothing is recorded.

## Download and reset

In **Progress → On this device**:

- **Download progress (JSON)** saves `wwm-learning-progress.json` (`format: wwm-learning-device-export/1`): every profile and event on this device.
- **Change name or Pip → Delete <nickname>** removes that child, all their events and any unsent outbox entries.
- **Delete progress on this device** removes every child, event, outbox entry and device link, after a confirmation.

Clearing the browser's site data for the lessons' origin does the same. In a private window, or with site storage turned off, lessons still work, nothing is saved, and Progress says so.

## Next

- **M3** adds optional parent accounts: "Sign in to keep progress across devices" mounts in Progress's `#account-slot`, and a sync client sends the outbox (`outbox()`/`markSynced()`) to `POST /api/learning/events`.
- **M5** has the maze use the same store and picker, and record `surface: 'maze'` evidence.
