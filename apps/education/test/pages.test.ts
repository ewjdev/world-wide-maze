import {
  AVATARS,
  applyDraft,
  applyFamilySettings,
  baselinePath,
  choiceKeys,
  describeLevel,
  evidenceId,
  inputPolicy,
  type LearningEvidence,
  type LearningPath,
  learningScript,
  levelsFor,
  objectiveProgress,
  type Profile,
  preschoolActivities,
  type Round,
  readLearningHtml,
  requiredRounds,
} from '@wwm/learning';
import { describe, expect, it } from 'vitest';
import { lessonFromHtml } from '../../web/src/learning/load.ts';
import { HOLD_MS, holdButtonHtml } from '../src/hold.ts';
import { AVATAR_LOOKS, avatarSvg } from '../src/profiles.ts';
import {
  childHtml,
  isListening,
  NICKNAME_HELP,
  PRACTICE_NOTE,
  practisedOn,
  progressPage,
  STATE_COPY,
} from '../src/progress-render.ts';
import {
  escapeHtml,
  gameLevelText,
  homePage,
  inputHintHtml,
  lessonPage,
  levelChoiceText,
  planksBuilt,
  portablePage,
  roundCheck,
  sceneBlock,
  spokenHtml,
} from '../src/render.ts';
import { parseSettings } from '../src/storage.ts';

const compare = baselinePath.activities.find((activity) => activity.id === 'compare-groups');
if (!compare) throw new Error('compare-groups missing');

describe('readable HTML and machine intent', () => {
  it('publishes each lesson’s intro, first round, scene and grown-up notes before any JavaScript', () => {
    const home = homePage(baselinePath);
    for (const activity of baselinePath.activities) {
      expect(home).toContain(`/lessons/${activity.id}/`);
      const html = lessonPage(baselinePath, activity);
      const first = activity.rounds[0];
      expect(html).toContain(`data-learning-activity="${activity.id}"`);
      expect(html).toContain(escapeHtml(activity.introduction));
      expect(html).toContain(`id="pip-start"`);
      // the first round is on the page, with its scene and (disabled) answer buttons
      expect(html).toContain(`data-learning-round="${first?.id}"`);
      expect(html).toContain(spokenHtml(first?.prompt ?? ''));
      expect(html).toContain('class="wwm-scene"');
      expect(html.match(/class="choice-hit"[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(2);
      // every round is readable for grown-ups
      for (const round of activity.rounds) {
        expect(html).toContain(escapeHtml(round.prompt));
        for (const hint of round.hints) expect(html).toContain(escapeHtml(hint));
        expect(html).toContain(escapeHtml(round.success));
      }
      expect(html).toContain(escapeHtml(activity.objective));
      expect(html).toContain(escapeHtml(activity.offlineActivity));
      expect(html).toContain('One play-through is practice, not an assessment of mastery.');
      expect(html).toContain(learningScript(baselinePath));
      // without JavaScript the stage is revealed by a <noscript> style
      expect(html).toContain('<noscript><style>#stage[hidden]{display:block!important}');
    }
  });

  it('describes compare-groups as a 7-round challenge (two fresh examples) and names what each round checks', () => {
    expect(homePage(baselinePath)).toContain('7-round challenge with the match tool');
    // count-three: one written round and two fresh examples
    expect(homePage(baselinePath)).toContain('3-round challenge');
    const checks = compare.rounds.map((round, index) => roundCheck(compare, round, index));
    expect(checks).toEqual([
      'Warm-up: 2 in a dice pattern vs 4 in a dice pattern',
      'Close call: 5 scattered vs 4 scattered',
      'Trick: 3 spread out vs 5 bunched up',
      'Trick again: 6 small bunched up vs 4 big spread out (played only if round 3 needed the match tool)',
      'Same: 4 spread out vs 4 bunched up, or “Same”',
      'Bonus: 3 in a dice pattern vs 6 in a dice pattern (optional)',
      'Bonus, how many more: 3 vs 6; choose 2, 3, 4 (optional)',
    ]);
  });

  it('builds one plank per required round', () => {
    expect(requiredRounds(compare)).toBe(4);
    expect(compare.rounds.map((_, index) => planksBuilt(compare, index))).toEqual([0, 1, 2, 3, 3, 4, 4]);
    expect(planksBuilt(compare, 2, true)).toBe(3);
    // the conditional follow-up and bonus rounds add no plank
    expect(planksBuilt(compare, 3, true)).toBe(3);
    expect(planksBuilt(compare, 6, true)).toBe(4);
  });

  it('keeps word spans text-identical to the spoken line', () => {
    const text = 'Tricky one!  Some <gems> are "spread" out.';
    const html = spokenHtml(text);
    expect(html.replace(/<[^>]+>/g, '')).toBe(escapeHtml(text));
    expect(html.match(/data-w=/g)).toHaveLength(7);
  });

  it('escapes authored strings in visible HTML as well as in JSON', () => {
    const title = '<img src=x onerror=alert(1)>';
    const html = homePage({ ...baselinePath, title });
    expect(html).not.toContain(title);
    expect(html).toContain('&lt;img');
    const lesson = lessonPage(baselinePath, { ...compare, introduction: title });
    expect(lesson).not.toContain(title);
    expect(portablePage({ ...baselinePath, title })).not.toContain(title);
  });
});

describe('portable download', () => {
  it('loads each new lesson from its own portable file, with its Spanish models and spelling intact', () => {
    for (const activity of preschoolActivities) {
      const html = portablePage({ ...baselinePath, voice: undefined, activities: [activity] });
      const loaded = lessonFromHtml(html, `${activity.id}.html`);
      expect(loaded.activity).toEqual(activity);
      expect(loaded.path.activities).toHaveLength(1);
      expect(html).toContain(`lang="${activity.rounds[0]?.practice?.language}"`);
      expect(lessonPage(baselinePath, activity)).toContain(`href="/lesson-packs/${activity.id}.html"`);
    }
  });
  const invariants = (html: string) => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script id="wwm-learning" type="application/json">');
    expect(html).not.toContain('src=');
    expect(html).not.toMatch(/href=|url\(|@import|<link|<img|<iframe/i);
    expect(html.match(/<article data-learning-activity=/g)).toHaveLength(11);
  };

  it('has one inert JSON script, no external resources, and the themed pictures inline', () => {
    const html = portablePage(baselinePath);
    invariants(html);
    const rounds = baselinePath.activities.reduce((sum, activity) => sum + activity.rounds.length, 0);
    expect(html.match(/class="wwm-scene"/g)).toHaveLength(rounds);
    for (const activity of baselinePath.activities) {
      expect(html).toContain(escapeHtml(activity.objective));
      expect(html).toContain(escapeHtml(activity.parentNote));
      for (const round of activity.rounds) {
        expect(html).toContain(escapeHtml(round.prompt));
        for (const hint of round.hints) expect(html).toContain(escapeHtml(hint));
        expect(html).toContain(escapeHtml(round.success));
      }
    }
  });

  it('round-trips through readLearningHtml, for the baseline and a family fork', () => {
    expect(readLearningHtml(portablePage(baselinePath))).toEqual(baselinePath);
    const fork: LearningPath = applyDraft(baselinePath, {
      baselineId: baselinePath.id,
      baselineVersion: '1.0.0',
      title: 'Space </script><script>alert(1)</script> discoveries',
      description: 'Explore together.',
      introductions: baselinePath.activities.map((activity) => ({
        activityId: activity.id,
        text: 'Pip blasts off to a new planet.',
      })),
    });
    const html = portablePage(fork, '2026-09-26T12:00:00.000Z');
    invariants(html);
    expect(html).toContain('Family introductions accepted 2026-09-26T12:00:00.000Z.');
    expect(readLearningHtml(html)).toEqual(fork);
  });
});

describe('answering: key badges and the input hint (Phase 22)', () => {
  const round = (id: string) => compare.rounds.find((candidate) => candidate.id === id) as Round;
  const desktop = { tap: true, keyboard: true, tilt: false };

  it('shows key badges only when asked, and names each key after the visible label', () => {
    const r2 = round('r2');
    const plain = sceneBlock(baselinePath.theme, compare, r2, {
      orientation: 'wide',
      built: 1,
      enabled: true,
    });
    expect(plain).not.toContain('class="wwm-scene show-keys"');
    expect(plain).toContain('aria-label="Island A: 5 gems"');
    const keyed = sceneBlock(baselinePath.theme, compare, r2, {
      orientation: 'wide',
      built: 1,
      enabled: true,
      keys: choiceKeys(r2),
    });
    expect(keyed).toContain('<svg class="wwm-scene show-keys"');
    expect(keyed).toContain('aria-label="Island A: 5 gems. Key A"');
    expect(keyed).toContain('aria-label="Island B: 4 gems. Key B"');
    // a preview (the bonus offer) never shows keys
    expect(
      sceneBlock(baselinePath.theme, compare, r2, {
        orientation: 'wide',
        built: 1,
        enabled: true,
        preview: true,
        keys: choiceKeys(r2),
      }),
    ).not.toContain('class="wwm-scene show-keys"');
  });

  it('writes the input hint from the round’s policy, keys in on-screen order', () => {
    const hint = (
      id: string,
      device = desktop,
      path: Pick<LearningPath, 'play' | 'family'> = baselinePath,
    ) => {
      const r = round(id);
      return inputHintHtml(r, inputPolicy(path, compare, r, device), choiceKeys(r), 'wide');
    };
    expect(hint('r1')).toBe('');
    expect(hint('r2')).toBe('Press <kbd>A</kbd> or <kbd>B</kbd>');
    expect(hint('r4')).toBe('Press <kbd>A</kbd>, <kbd>S</kbd> or <kbd>B</kbd>');
    expect(hint('r3b')).toBe('Use <kbd>←</kbd> <kbd>→</kbd>, then <kbd>Enter</kbd>');
    expect(hint('r5b')).toBe('Type the number: <kbd>2</kbd>, <kbd>3</kbd> or <kbd>4</kbd>');
    // a touch-only device and the tap-only setting both fall back to tapping: no hint
    expect(hint('r2', { tap: true, keyboard: false, tilt: false })).toBe('');
    expect(hint('r5b', desktop, { ...baselinePath, family: { levels: {}, tapOnly: true } })).toBe('');
  });
});

describe('game settings (Phase 22)', () => {
  const chosen = applyFamilySettings(baselinePath, {
    levels: { 'compare-groups': 'mission' },
    tapOnly: true,
  });

  it('lists every lesson’s own levels, described, with the author’s default marked', () => {
    const html = homePage(baselinePath);
    expect(html).toContain('id="game-settings"');
    expect(html).toContain('Answer by tapping only');
    expect(html).toContain('For children who find keys or tilting hard');
    expect(html).toContain('Use the lesson’s recommendation for every lesson');
    expect(html).toContain('Reset game settings');
    for (const activity of baselinePath.activities)
      for (const level of levelsFor(activity)) {
        expect(html).toContain(`id="level-${activity.id}-${level.id}"`);
        expect(html).toContain(escapeHtml(describeLevel(activity, level)));
      }
    expect(html.match(/\(recommended by the lesson\)<\/span><span class="level-description">/g)).toHaveLength(
      baselinePath.activities.length,
    );
    expect(html).toMatch(/id="level-compare-groups-gated" name="level-compare-groups" value="gated" checked/);
    // with a family choice the page is rendered with it checked
    expect(homePage(chosen)).toMatch(
      /id="level-compare-groups-mission" name="level-compare-groups" value="mission" checked/,
    );
    expect(levelChoiceText(chosen, compare)).toBe('Missions (your choice)');
    expect(levelChoiceText(baselinePath, compare)).toBe('Gated (recommended by the lesson)');
  });

  it('names the level in the lesson’s grown-up notes', () => {
    const gated = levelsFor(compare).find((level) => level.id === 'gated');
    if (!gated) throw new Error('gated missing');
    expect(gameLevelText(baselinePath, compare)).toBe(
      `In the game: Gated (recommended by the lesson). ${describeLevel(compare, gated)}`,
    );
    expect(lessonPage(baselinePath, compare)).toContain(escapeHtml(gameLevelText(baselinePath, compare)));
    expect(gameLevelText(chosen, compare)).toMatch(/^In the game: Missions\. .* Answering: tapping only\.$/);
  });

  it('exports the grown-up’s choices: `family` in the JSON and a readable Game settings section', () => {
    const html = portablePage(chosen);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toContain('src=');
    expect(readLearningHtml(html)).toEqual(chosen);
    expect(readLearningHtml(html).family).toEqual({ levels: { 'compare-groups': 'mission' }, tapOnly: true });
    expect(html).toContain('<h2>Game settings</h2>');
    expect(html).toContain('Chosen by a grown-up for this family.');
    expect(html).toContain('<strong>Which has more?:</strong> Missions.');
    expect(html).toContain('Answering: tapping only (a grown-up setting).');
    // the baseline lists the recommendations
    const original = portablePage(baselinePath);
    expect(original).toContain('<strong>Which has more?:</strong> Gated (recommended by the lesson).');
    expect(original).toContain('A tap is always accepted after two gentle reminders.');
  });

  it('accepts only valid stored settings (fail closed, like applyFamilySettings)', () => {
    const valid = { levels: { 'compare-groups': 'explore' }, tapOnly: false };
    expect(parseSettings(valid, baselinePath)).toEqual(valid);
    expect(parseSettings({ levels: {}, tapOnly: true }, baselinePath)).toEqual({ levels: {}, tapOnly: true });
    for (const bad of [
      null,
      'x',
      [],
      { levels: {} },
      { levels: {}, tapOnly: 'yes' },
      { levels: [], tapOnly: false },
      { levels: { 'compare-groups': 3 }, tapOnly: false },
      { levels: { 'compare-groups': 'no-such-level' }, tapOnly: false },
      { levels: { 'no-such-lesson': 'gated' }, tapOnly: false },
      { levels: {}, tapOnly: false, extra: 1 },
    ])
      expect(parseSettings(bad, baselinePath), JSON.stringify(bad)).toBeNull();
  });
});

describe('profiles and Progress (Phase 31 M2)', () => {
  const at = (iso: string, over: Partial<LearningEvidence> = {}): LearningEvidence => ({
    v: 1,
    id: evidenceId(Date.parse(iso)),
    profile: 'mia-profile-00001',
    at: iso,
    activity: 'count-three',
    objective: 'count-three',
    round: 'fresh-1',
    item: 'a'.repeat(32),
    source: 'generator',
    fresh: true,
    outcome: 'first-try',
    helpLevel: 0,
    surface: 'lesson',
    input: 'tap',
    duration: 'lt10s',
    ...over,
  });
  const objectives = (baselinePath.objectives ?? []).map((objective) => objective.id);
  const mia: Profile = { id: 'mia-profile-00001', nickname: 'Mia', avatar: 'pip-yellow' };

  it('turns fresh examples on for the four generated objectives, shown in the grown-up notes', () => {
    const fresh = baselinePath.activities.filter((activity) => activity.fresh).map((activity) => activity.id);
    expect(fresh).toEqual(['count-three', 'count-five', 'compare-groups', 'spanish-colors']);
    expect(lessonPage(baselinePath, compare)).toContain('<strong>Then two new examples.</strong>');
    const triangle = baselinePath.activities.find((activity) => activity.id === 'find-triangle');
    expect(triangle && lessonPage(baselinePath, triangle)).not.toContain('new examples');
  });

  it('ships the picker and the who’s-playing switch hidden, so a lesson without profiles looks as before', () => {
    const html = lessonPage(baselinePath, compare);
    expect(html).toMatch(/<section class="picker" id="picker"[^>]*hidden>/);
    expect(html).toMatch(/<div class="player-bar" id="player-bar" hidden>/);
    expect(html).toContain(
      '<span class="hold-label">Switch who’s playing</span><span class="hold-hint">Press and hold for 2 seconds (or hold G)</span>',
    );
  });

  it('draws six Pip avatars that differ by shape as well as colour', () => {
    const avatars = Object.keys(AVATAR_LOOKS) as (keyof typeof AVATAR_LOOKS)[];
    expect(avatars).toEqual([...AVATARS]);
    expect(new Set(avatars.map((avatar) => AVATAR_LOOKS[avatar].mark)).size).toBe(avatars.length);
    for (const avatar of avatars) {
      const svg = avatarSvg(baselinePath.theme, avatar, 56);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain(AVATAR_LOOKS[avatar].shell);
      expect(svg).not.toMatch(/<script|on\w+=/);
    }
  });

  it('labels a hold button with its visible text first', () => {
    expect(HOLD_MS).toBe(2000);
    expect(holdButtonHtml('x', 'Open "Progress"')).toContain(
      '<span class="hold-label">Open &quot;Progress&quot;</span><span class="hold-hint">',
    );
  });

  it('writes the Progress page with its fixed copy, the M3 slot, and no score anywhere', () => {
    const html = progressPage(baselinePath);
    expect(html).toContain(PRACTICE_NOTE);
    expect(html).toContain('Saved on this device only.');
    expect(html).toContain(escapeHtml(NICKNAME_HELP));
    expect(html).toContain('Download progress (JSON)');
    expect(html).toContain('Delete progress on this device');
    expect(html).toContain('<!-- M3 SLOT:');
    expect(html).toContain('id="account-slot"');
    expect(html).toMatch(/<div class="progress-area" id="progress-area" hidden>/);
    for (const copy of Object.values(STATE_COPY)) expect(html).toContain(copy);
    expect(html).not.toMatch(/%|\/ ?\d+ correct|ranking/i);
  });

  it('shows each objective’s state in plain words, practised first, with Try together and listening labels', () => {
    const events = [
      at('2026-10-18T17:00:00.000Z', { item: 'b'.repeat(32) }),
      at('2026-10-19T17:00:00.000Z', { item: 'c'.repeat(32) }),
      at('2026-10-19T17:05:00.000Z', {
        activity: 'spanish-colors',
        objective: 'spanish-colors',
        outcome: 'after-retry',
        helpLevel: 1,
      }),
    ];
    const progress = objectiveProgress(events, objectives, { timeZone: 'America/New_York' });
    const html = childHtml(baselinePath, mia, progress, { timeZone: 'America/New_York', picker: true });
    expect(html).toContain('<p class="state" data-state="got-it">Got it on new examples</p>');
    expect(html).toContain('<p class="state" data-state="with-help">Getting there with help</p>');
    expect(html.indexOf('data-objective="spanish-colors" data-state="with-help"')).toBeLessThan(
      html.indexOf('data-objective="count-three" data-state="got-it"'),
    );
    expect(html).toContain('Last practised 19 October 2026');
    expect(html).toContain(`Not tried yet (${objectives.length - 2})`);
    expect(html).toContain(escapeHtml(countThreeActivity().offlineActivity));
    expect(html.match(/Listening practice/g)?.length).toBe(
      baselinePath.activities.filter((activity) => isListening(activity)).length,
    );
    expect(html).not.toMatch(/%/);
  });

  it('escapes nicknames and counts days on the family’s calendar', () => {
    const html = childHtml(baselinePath, { ...mia, nickname: "D'Arcy" }, objectiveProgress([], objectives), {
      picker: false,
    });
    expect(html).toContain('D&#39;Arcy');
    expect(html).toContain('Lessons on this device save practice for D&#39;Arcy.');
    // 02:30 UTC on the 19th is still the 18th in New York
    expect(practisedOn('2026-10-19T02:30:00.000Z', 'America/New_York')).toBe('18 October 2026');
    expect(practisedOn('2026-10-19T02:30:00.000Z', 'UTC')).toBe('19 October 2026');
  });

  it('labels listening-dependent lessons from their rounds', () => {
    expect(isListening(compare)).toBe(false);
    expect(preschoolActivities.every((activity) => isListening(activity))).toBe(true);
  });
});

function countThreeActivity() {
  const found = baselinePath.activities.find((activity) => activity.id === 'count-three');
  if (!found) throw new Error('count-three missing');
  return found;
}
