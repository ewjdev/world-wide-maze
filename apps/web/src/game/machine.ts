/**
 * The game's phase machine (contracts §6 `GamePhase`), as an explicit typed transition table.
 *
 * It is pure: `transition(phase, event)` returns the next phase or `null` when the event is illegal in that
 * phase. Every decision that depends on game data (first visit? paired? spares left? more slices?) arrives
 * in the event payload, so the table stays small and every edge is unit-tested. Side effects (engine, sim,
 * audio, network) live in `Game` (game.ts), which dispatches these events.
 *
 * Sources: the 2013 app + world FSMs (docs/reference/bundle-notes.md §5.2, §9) and ux-flow.md. `countdown`,
 * the map menu's "retry" and the disconnect handling are N.
 */
import type { GamePhase } from '@wwm/schema';

export type GameEvent =
  /** Title "Start". `howtoSeen`: first visit shows how-to (E). `ready`: input already chosen/paired. */
  | { type: 'START'; howtoSeen: boolean; ready: boolean }
  | { type: 'HOWTO_DONE' }
  /** Phone paired (E: "Connected!" then calibrate on the first game). */
  | { type: 'PAIRED' }
  /** E: "No smartphone? Play with PC only". Also the calibration-timeout keyboard fallback. */
  | { type: 'KEYBOARD' }
  | { type: 'CALIBRATED' }
  /** A site or curated stage was chosen (or a deep link / next slice). */
  | { type: 'CHOOSE' }
  | { type: 'BUILT' }
  | { type: 'BUILD_FAILED' }
  /** Intro finished or skipped. `countdown`: show the N countdown (not on the tutorial game). */
  | { type: 'INTRO_DONE'; countdown: boolean }
  | { type: 'GO' }
  | { type: 'MENU' }
  | { type: 'RESUME' }
  /** Map menu: retry the stage from its intro (N). */
  | { type: 'RETRY' }
  /** Map menu / result: search another site. */
  | { type: 'SEARCH' }
  | { type: 'QUIT' }
  | { type: 'FELL' }
  /** E: `lost` 3 s after `fell`, plus 3 s: restart, or game over when spares < 0. */
  | { type: 'LOST'; spares: number }
  | { type: 'TIMESUP' }
  /** After the TIME IS UP sign: restart, or game over when spares < 0. */
  | { type: 'SIGN_DONE'; spares: number }
  | { type: 'SPAWNED' }
  | { type: 'GOAL' }
  | { type: 'GOAL_DONE' }
  /** Result "Next stage": `more` = another slice of this page (else back to site select, E). */
  | { type: 'NEXT'; more: boolean }
  | { type: 'FINISH' }
  | { type: 'NEW_GAME' }
  | { type: 'TITLE' }
  | { type: 'BACK' }
  | { type: 'FAIL' };

export type GameEventType = GameEvent['type'];

type Rule = GamePhase | ((e: GameEvent) => GamePhase);
type Table = { [P in GamePhase]: Partial<Record<GameEventType, Rule>> };

export const TRANSITIONS: Table = {
  title: {
    START: (e) => {
      const s = e as Extract<GameEvent, { type: 'START' }>;
      if (!s.howtoSeen) return 'howto';
      return s.ready ? 'select' : 'pairing';
    },
    CHOOSE: 'building', // deep link /play/:stageId
  },
  howto: { HOWTO_DONE: 'pairing', BACK: 'title' },
  pairing: { PAIRED: 'calibrate', KEYBOARD: 'select', BACK: 'title' },
  calibrate: { CALIBRATED: 'select', KEYBOARD: 'select', BACK: 'pairing' },
  select: { CHOOSE: 'building', BACK: 'title', TITLE: 'title' },
  building: { BUILT: 'intro', BUILD_FAILED: 'error', BACK: 'select' },
  intro: {
    INTRO_DONE: (e) => ((e as Extract<GameEvent, { type: 'INTRO_DONE' }>).countdown ? 'countdown' : 'play'),
    QUIT: 'title',
  },
  countdown: { GO: 'play', MENU: 'paused' },
  play: { MENU: 'paused', FELL: 'falling', TIMESUP: 'timeup', GOAL: 'goal' },
  paused: { RESUME: 'play', RETRY: 'building', SEARCH: 'select', QUIT: 'title' },
  falling: {
    LOST: (e) => ((e as Extract<GameEvent, { type: 'LOST' }>).spares < 0 ? 'gameover' : 'restarting'),
  },
  timeup: {
    SIGN_DONE: (e) =>
      (e as Extract<GameEvent, { type: 'SIGN_DONE' }>).spares < 0 ? 'gameover' : 'restarting',
  },
  restarting: { SPAWNED: 'play' },
  goal: { GOAL_DONE: 'result' },
  gameover: { SIGN_DONE: 'ranking' },
  result: {
    NEXT: (e) => ((e as Extract<GameEvent, { type: 'NEXT' }>).more ? 'building' : 'select'),
    FINISH: 'ranking',
  },
  ranking: { NEW_GAME: 'select', TITLE: 'title' },
  error: { CHOOSE: 'building', BACK: 'select', TITLE: 'title' },
};

/** Phases that belong to a stage being played (the world is loaded). */
export const IN_STAGE: ReadonlySet<GamePhase> = new Set<GamePhase>([
  'intro',
  'countdown',
  'play',
  'paused',
  'falling',
  'restarting',
  'goal',
  'timeup',
  'gameover',
]);

/** Phases where a controller disconnect must freeze the world (N). */
export const HOLD_ON_DISCONNECT: ReadonlySet<GamePhase> = new Set<GamePhase>([
  'countdown',
  'play',
  'falling',
  'restarting',
]);

export function transition(phase: GamePhase, event: GameEvent): GamePhase | null {
  // Global edges: a fatal failure goes to the error screen; the title is always reachable.
  if (event.type === 'FAIL') return 'error';
  const rule = TRANSITIONS[phase][event.type];
  if (rule === undefined) return null;
  return typeof rule === 'function' ? rule(event) : rule;
}
