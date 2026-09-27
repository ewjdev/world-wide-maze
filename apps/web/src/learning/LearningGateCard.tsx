/**
 * Phase 20 M4b (N): the Pip gate card. While it shows, the maze waits (game.ts pauses the driver and the timer).
 *
 * The round is drawn by `sceneSvg` from @wwm/learning, the trusted renderer shared with the lesson page: it only
 * writes numbers, palette colours validated as hex by the document schema, and text it escapes itself, so the
 * markup is safe for `dangerouslySetInnerHTML` even for a document loaded from a file. Nothing from the document
 * is ever inserted as markup any other way (docs/education/html-contract.md).
 *
 * The scene is animated the way scene.ts documents: classes toggled on its marked elements, from the step's
 * `show` (pulse, retry, match, worked, celebrate) and from voice cues (a spoken number lights a gem, a spoken
 * "match" draws a pair line, "left over" marks the leftovers). Transparent buttons over the choice boxes take
 * taps; the cursor (tilt / arrow keys) is the scene's `is-focus` halo.
 *
 * Phase 22: the round is the one shown in this session (shuffled positions). Pip's callout names each choice and a
 * `choice` cue pulses it (`.is-callout` on the mark and its key badge). When the round invites letter or number
 * keys, the scene shows its key badges (`show-keys`); an answer through an input the round didn't invite gets a
 * gentle nudge (twice, then it's accepted) and the badges flash.
 */
import '@wwm/learning/scene.css';
import {
  type Cue,
  type InputMode,
  type LessonState,
  layoutGroup,
  neutralLabels,
  pairUp,
  type Round,
  requiredRounds,
  sceneLayout,
  sceneSvg,
  spriteMarkup,
} from '@wwm/learning';
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useGame, useView } from '../ui/GameApp.tsx';
import { Glyphs, Icon } from '../ui/parts.tsx';
import type { GateView, LearningGates, LearningView } from './gates.ts';
import './learning.css';

type Style = CSSProperties & Record<`--${string}`, string>;

export function useLearning(): [LearningGates, LearningView] {
  const g = useGame();
  const view = useSyncExternalStore(g.learning.subscribe, g.learning.getView, g.learning.getView);
  return [g.learning, view];
}

const EFFECTS = [
  'is-callout',
  'is-lit',
  'is-leftover',
  'is-shown',
  'is-correct',
  'is-retry',
  'is-glow',
  'is-pulse',
  'is-happy',
];

function clearEffects(root: Element): void {
  for (const cls of EFFECTS) for (const el of root.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
}

/** Re-add a class so its CSS animation runs again. */
function restart(el: Element | null, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).getBoundingClientRect();
  el.classList.add(cls);
}

const mark = (root: Element, id: string | null) =>
  id === null ? null : root.querySelector(`[data-choice-mark="${CSS.escape(id)}"]`);

/** Leftover gems of a round with islands (the same pairing the match line narrates). */
function leftoverGems(round: Round): string[] {
  if (round.kind === 'choose') return [];
  const p = pairUp(layoutGroup(round.islands[0]), layoutGroup(round.islands[1]));
  return p.extra ? p.leftovers.map((i) => `${p.extra}-${i}`) : [];
}

function pairCount(round: Round): number {
  if (round.kind === 'choose') return 0;
  return Math.min(round.islands[0].count, round.islands[1].count);
}

function showMatch(root: Element, round: Round): void {
  for (const el of root.querySelectorAll('[data-pair]')) el.classList.add('is-shown');
  for (const id of leftoverGems(round))
    root.querySelector(`[data-gem="${id}"]`)?.classList.add('is-leftover');
}

function applyShow(root: Element, gate: GateView): void {
  const { state, round, show } = gate;
  switch (show) {
    case 'pulse':
      for (const el of root.querySelectorAll('[data-choice-mark]')) restart(el, 'is-pulse');
      break;
    case 'retry':
      mark(root, state.choice)?.classList.add('is-retry');
      break;
    case 'worked':
      mark(root, String(round.answer))?.classList.add('is-glow');
      break;
    case 'celebrate':
      mark(root, state.choice)?.classList.add('is-correct');
      restart(root.querySelector('[data-pip]'), 'is-happy');
      restart(root.querySelector(`[data-plank="${state.built - 1}"]`), 'is-new');
      break;
    default:
      // 'match' draws its pairs on the voice's cues (below); a solved round keeps its check mark
      if (state.solved) mark(root, state.choice)?.classList.add('is-correct');
  }
}

function applyCue(root: Element, cue: Cue, round: Round): void {
  if (cue.type === 'choice') {
    for (const el of root.querySelectorAll('.is-callout')) el.classList.remove('is-callout');
    restart(mark(root, cue.id), 'is-callout');
    restart(root.querySelector(`[data-key-badge="${CSS.escape(cue.id)}"]`), 'is-callout');
  } else if (cue.type === 'light')
    root.querySelector(`[data-gem="${cue.island}-${cue.index}"]`)?.classList.add('is-lit');
  else if (cue.type === 'pair') root.querySelector(`[data-pair="${cue.index}"]`)?.classList.add('is-shown');
  else
    for (const id of leftoverGems(round))
      root.querySelector(`[data-gem="${id}"]`)?.classList.add('is-leftover');
}

/** What Pip's bubble shows: the latest hint, or the success line once solved (the voice says the same). */
function feedback(round: Round, state: LessonState): string | null {
  if (state.solved) return round.success;
  if (state.hintLevel > 0) return round.hints[Math.min(state.hintLevel, round.hints.length) - 1] ?? null;
  return null;
}

export function LearningGateCard() {
  const [learning, view] = useLearning();
  const gate = view.gate;
  const lesson = learning.lesson;
  if (!gate || !lesson) return null;
  return <GateCard gate={gate} learning={learning} speaking={view.speaking} />;
}

function GateCard({
  gate,
  learning,
  speaking,
}: {
  gate: GateView;
  learning: LearningGates;
  speaking: string | null;
}) {
  const v = useView();
  const { t } = useTranslation();
  const lesson = learning.lesson;
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the card when a (different) gate opens
  useEffect(() => root.current?.focus(), [gate.gateId]);
  // choosing with the arrows / tilt takes focus back from a card button, so Enter / JUMP answers the choice
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the cursor moves
  useEffect(() => {
    const el = root.current;
    const active = document.activeElement;
    if (el && active && active !== el && el.contains(active) && !active.matches('.wwm-lgate__choice'))
      el.focus();
  }, [gate.cursor]);
  if (!lesson) return null;
  const { path, activity } = lesson;
  const theme = path.theme;
  const phone = v.inputMode === 'phone';
  const planks = requiredRounds(activity);
  const style = { '--pc': theme.palette.gate, '--glow': theme.palette.glow } as Style;
  const eyebrow = gate.number > 0 ? t('learning.gate.label', { n: gate.number }) : t('learning.gate.start');
  const invite = gate.policy.promptLine?.replace(/^pip\.input\./, '') as InputMode | undefined;
  const tapOnly = !!lesson.path.family?.tapOnly;
  const nextLabel =
    gate.next === 'follow-up'
      ? t('learning.gate.oneMore')
      : gate.next === 'more'
        ? t('learning.gate.next')
        : t('learning.gate.rollOn');
  const pip = spriteMarkup(theme, 'pip', 72, 'wwm-lgate__pipsvg');
  const pipButton = (
    <button
      type="button"
      className={`wwm-lgate__pip${speaking ? ' is-speaking' : ''}`}
      onClick={() => learning.replay()}
      aria-label={t('learning.gate.replay')}
      title={t('learning.gate.replay')}
      data-testid="lgate-replay"
      // trusted renderer output (numbers and validated hex colours only)
      // biome-ignore lint/security/noDangerouslySetInnerHtml: see the file comment
      dangerouslySetInnerHTML={{ __html: pip }}
    />
  );

  if (gate.mode !== 'round') {
    const bonus = gate.mode === 'bonus-offer';
    return (
      <div
        className="wwm-lgate wwm-lgate--compact"
        style={style}
        data-testid="learning-gate"
        data-mode={gate.mode}
      >
        <div className="wwm-lgate__frame">
          <section
            ref={root}
            tabIndex={-1}
            className="wwm-lgate__card"
            role="dialog"
            aria-labelledby="lgate-h"
            data-testid="lgate-card"
          >
            <header className="wwm-lgate__head">
              {pipButton}
              <div className="wwm-lgate__titles">
                <p className="wwm-lgate__eyebrow">
                  {eyebrow} · {activity.title}
                </p>
                <h2 id="lgate-h" className="wwm-lgate__prompt" data-testid="lgate-prompt">
                  {bonus ? t('learning.gate.bonusTitle') : t('learning.gate.doneTitle')}
                </h2>
              </div>
            </header>
            <p
              className="wwm-lgate__say wwm-lgate__say--wide"
              aria-live="polite"
              data-testid="lgate-feedback"
            >
              {bonus ? theme.guide.lines.bonus : `${activity.finale} ${t('learning.gate.doneBody')}`}
            </p>
            <div className="wwm-lgate__actions">
              {bonus ? (
                <>
                  <button
                    type="button"
                    className="wwm-btn wwm-btn--primary wwm-lgate__go"
                    onClick={() => learning.bonus(true)}
                    data-testid="lgate-bonus-play"
                  >
                    {t('learning.gate.bonusPlay')}
                  </button>
                  <button
                    type="button"
                    className="wwm-btn wwm-btn--ghost"
                    onClick={() => learning.bonus(false)}
                    data-testid="lgate-bonus-skip"
                  >
                    {t('learning.gate.bonusSkip')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="wwm-btn wwm-btn--primary wwm-lgate__go"
                  onClick={() => learning.rollOn()}
                  data-testid="lgate-rollon"
                >
                  {t('learning.gate.rollOn')} <Icon name="arrow" />
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="wwm-lgate" style={style} data-testid="learning-gate" data-mode={gate.mode}>
      <div className="wwm-lgate__frame">
        <section
          ref={root}
          tabIndex={-1}
          className="wwm-lgate__card"
          role="dialog"
          aria-labelledby="lgate-h"
          data-testid="lgate-card"
          data-round={gate.round.id}
          data-solved={gate.state.solved}
        >
          <header className="wwm-lgate__head">
            {pipButton}
            <div className="wwm-lgate__titles">
              <p className="wwm-lgate__eyebrow">
                {eyebrow} · {activity.title}
              </p>
              <h2 id="lgate-h" className="wwm-lgate__prompt" data-testid="lgate-prompt">
                {gate.round.prompt}
              </h2>
              {invite && !tapOnly && !gate.state.solved && (
                <p className="wwm-lgate__invite" data-testid="lgate-invite" data-mode={invite}>
                  {t(`learning.input.${invite}`)}
                </p>
              )}
            </div>
            <p className="wwm-lgate__bridge">
              {t('learning.gate.bridge', { built: Math.min(gate.state.built, planks), total: planks })}
            </p>
          </header>
          <div className="wwm-lgate__main">
            <Scene gate={gate} learning={learning} planks={planks} sceneRef={scene} />
            <aside className="wwm-lgate__side">
              <Feedback gate={gate} />
              <div className="wwm-lgate__actions wwm-lgate__actions--side">
                {gate.state.solved ? (
                  <button
                    type="button"
                    className="wwm-btn wwm-btn--primary wwm-lgate__go"
                    onClick={() => learning.proceed()}
                    data-testid="lgate-rollon"
                    data-next={gate.next}
                  >
                    {nextLabel} <Icon name="arrow" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="wwm-btn wwm-btn--ghost"
                      onClick={() => learning.hint()}
                      data-testid="lgate-help"
                    >
                      {t('learning.gate.help')}
                    </button>
                    {gate.round.kind !== 'choose' && (
                      <button
                        type="button"
                        className="wwm-btn wwm-btn--secondary"
                        onClick={() => learning.match()}
                        data-testid="lgate-match"
                      >
                        {t('learning.gate.match')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="wwm-btn wwm-btn--ghost wwm-btn--small wwm-lgate__skip"
                      onClick={() => learning.skip()}
                      data-testid="lgate-skip"
                      data-locking={gate.locking}
                    >
                      {gate.locking ? t('learning.gate.later') : t('learning.gate.skip')}
                    </button>
                  </>
                )}
              </div>
              {gate.policy.badges && !gate.state.solved && !phone && (
                <p className="wwm-lgate__keys wwm-lgate__keys--badges">{t('learning.gate.keysBadges')}</p>
              )}
              <p className="wwm-lgate__keys">
                <Glyphs
                  text={t(
                    gate.state.solved
                      ? phone
                        ? 'learning.gate.keysNextPhone'
                        : 'learning.gate.keysNextPc'
                      : phone
                        ? 'learning.gate.keysPhone'
                        : gate.locking
                          ? 'learning.gate.keysLater'
                          : 'learning.gate.keysPc',
                  )}
                />
              </p>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}

function Feedback({ gate }: { gate: GateView }) {
  const text = feedback(gate.round, gate.state);
  return (
    <p
      className={`wwm-lgate__say${gate.state.solved ? ' is-success' : ''}`}
      aria-live="polite"
      data-testid="lgate-feedback"
      hidden={!text}
    >
      {text}
    </p>
  );
}

function Scene({
  gate,
  learning,
  planks,
  sceneRef,
}: {
  gate: GateView;
  learning: LearningGates;
  planks: number;
  sceneRef: RefObject<HTMLDivElement | null>;
}) {
  const lesson = learning.lesson;
  const theme = lesson?.path.theme;
  const activity = lesson?.activity;
  const neutral = activity ? neutralLabels(activity) : true;
  const { round, state } = gate;
  const svg = useMemo(
    () => (theme ? sceneSvg(theme, round, { orientation: 'wide', planks, built: state.built, neutral }) : ''),
    [theme, round, planks, state.built, neutral],
  );
  const layout = useMemo(() => sceneLayout(round, 'wide', planks, neutral), [round, planks, neutral]);

  // the step's effect (every step changes `seq`, so the same effect replays)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `svg` re-renders the scene, `seq` is a new step
  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    clearEffects(el);
    applyShow(el, gate);
    if (gate.show !== 'match') return;
    // the voice draws the pairs; if it's cut short or silent, the full match still appears
    const done = setTimeout(() => showMatch(el, round), pairCount(round) * 700 + 2600);
    return () => clearTimeout(done);
  }, [svg, gate.seq]);

  // key badges when the round invites letter or number keys (again after `svg` re-renders the scene)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `svg` replaces the scene element
  useLayoutEffect(() => {
    sceneRef.current?.querySelector('svg.wwm-scene')?.classList.toggle('show-keys', gate.policy.badges);
  }, [svg, gate.policy.badges, sceneRef]);

  // a nudge towards the invited input: the badges (or the choices) flash
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each nudge
  useEffect(() => {
    const el = sceneRef.current;
    if (!el || gate.nudgeSeq === 0) return;
    const badges = el.querySelectorAll('[data-key-badge]');
    if (gate.policy.badges && badges.length > 0) for (const b of badges) restart(b, 'is-callout');
    else for (const m of el.querySelectorAll('[data-choice-mark]')) restart(m, 'is-pulse');
  }, [gate.nudgeSeq]);

  // the cursor: the scene's focus halo (again after `svg` re-renders the scene)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `svg` replaces the marks, the ref is stable
  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    for (const m of el.querySelectorAll('[data-choice-mark]')) m.classList.remove('is-focus');
    if (gate.cursor !== null && !state.solved)
      mark(el, gate.choices[gate.cursor] ?? null)?.classList.add('is-focus');
  }, [svg, gate.cursor, gate.choices, state.solved]);

  // voice cues for this round
  useEffect(() => {
    const prefix = `${activity?.id}.${round.id}.`;
    return learning.onCue((cue, line) => {
      const el = sceneRef.current;
      if (el && line.id.startsWith(prefix)) applyCue(el, cue, round);
    });
  }, [learning, activity?.id, round, sceneRef]);

  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  return (
    <div className="wwm-lgate__scene" data-testid="lgate-scene">
      <div
        ref={sceneRef}
        className="wwm-lgate__svg"
        // trusted renderer output (see the file comment)
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sceneSvg escapes and validates everything it writes
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {layout.choices.map((choice, i) => (
        <button
          key={choice.id}
          type="button"
          className={`wwm-lgate__choice${gate.cursor === i ? ' is-cursor' : ''}`}
          style={{
            left: pct(choice.box.x, layout.width),
            top: pct(choice.box.y, layout.height),
            width: pct(choice.box.w, layout.width),
            height: pct(choice.box.h, layout.height),
          }}
          aria-label={choice.ariaLabel}
          aria-pressed={state.solved && state.choice === choice.id}
          onClick={() => learning.tap(choice.id)}
          data-testid={`lgate-choice-${choice.id}`}
        />
      ))}
    </div>
  );
}
