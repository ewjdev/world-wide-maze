import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  baselinePath,
  type DraftRevision,
  parseLearningPath,
  type Round,
  readLearningHtml,
} from '@wwm/learning';
import { describe, expect, test } from 'vitest';
import { BankImportError, checkBank, importBank } from '../../../tools/lesson-draft/src/bank-import.ts';
import { previewHtml } from '../src/lesson-drafts/preview.ts';
import { DraftConflict, DraftIndex, DraftRecords } from '../src/lesson-drafts/records.ts';
import { mockRevision, sqliteExec } from './helpers/lesson-drafts.ts';

const NOW = '2026-10-19T12:00:00.000Z';
const OPERATOR = 'operator@example.com';

function draft() {
  const records = new DraftRecords(sqliteExec());
  records.create({
    id: 'd-1',
    objective: 'little-word-builders',
    brief: 'Animals',
    operator: OPERATOR,
    now: NOW,
  });
  return records;
}
async function turn(records: DraftRecords, revision?: DraftRevision) {
  const number = records.startTurn({ text: 'Animals', operator: OPERATOR, now: NOW });
  const rev = revision ?? (await mockRevision({ turn: number, base: records.base([]).items }));
  records.saveRevision(rev);
  records.finishTurn(number, rev.hash, rev.summary, NOW);
  return rev;
}

describe('draft records (the agent’s SQLite)', () => {
  test('one turn at a time; revisions and summaries are stored once even when a step replays', async () => {
    const records = draft();
    const number = records.startTurn({ text: 'Animals', operator: OPERATOR, now: NOW });
    expect(() => records.startTurn({ text: 'Again', operator: OPERATOR, now: NOW })).toThrow(DraftConflict);
    const revision = await mockRevision({ turn: number });
    records.saveRevision(revision);
    records.saveRevision(revision);
    records.finishTurn(number, revision.hash, revision.summary, NOW);
    records.finishTurn(number, revision.hash, revision.summary, NOW);
    const snapshot = records.snapshot();
    expect(snapshot?.status).toBe('ready');
    expect(snapshot?.revisions).toHaveLength(1);
    expect(snapshot?.messages.map((message) => message.role)).toEqual(['operator', 'agent']);
    expect(snapshot?.messages[1]).toMatchObject({ text: revision.summary, revision: revision.hash });
    expect(records.revision(revision.hash)).toEqual(revision);
  });

  test('a failed turn says so in the chat and the operator can try again', () => {
    const records = draft();
    const number = records.startTurn({ text: 'Animals', operator: OPERATOR, now: NOW });
    records.failTurn(number, 'model 529', NOW);
    expect(records.snapshot()).toMatchObject({ status: 'failed', error: 'model 529' });
    expect(records.snapshot()?.messages.at(-1)?.text).toContain('Turn 1 failed: model 529');
    expect(records.startTurn({ text: 'Again', operator: OPERATOR, now: NOW })).toBe(2);
  });

  test('the next turn builds on the latest revision minus dropped items', async () => {
    const records = draft();
    const first = await turn(records);
    const dropped = first.bank.items[0]?.id as string;
    const { items, dropped: gone } = records.base([dropped, 'i-000000000000']);
    expect(gone).toEqual([dropped]);
    expect(items.map((item) => item.id)).toEqual(first.bank.items.slice(1).map((item) => item.id));
    const second = await turn(records, await mockRevision({ turn: 2, base: items, dropped: gone }));
    expect(second.bank.items).toHaveLength(first.bank.items.length - 1 + 6);
    expect(new Set(second.bank.items.map((item) => item.practice?.text)).size).toBe(second.bank.items.length);
  });

  test('approval: only the latest clean revision, flags acknowledged, then the draft is locked', async () => {
    const records = draft();
    const first = await turn(records);
    const flagged = { ...(await mockRevision({ turn: 2, base: first.bank.items })), flags: ['Distractor…'] };
    await turn(records, flagged);
    const review = {
      decision: 'approved' as const,
      note: 'Checked every word',
      operator: OPERATOR,
      now: NOW,
    };
    expect(() => records.review({ ...review, revision: first.hash, acknowledgeFlags: true })).toThrow(
      'Only the latest revision',
    );
    expect(() => records.review({ ...review, revision: flagged.hash, acknowledgeFlags: false })).toThrow(
      'acknowledge the reviewer flags',
    );
    records.review({ ...review, revision: flagged.hash, acknowledgeFlags: true });
    expect(records.snapshot()).toMatchObject({
      status: 'approved',
      review: { decision: 'approved', note: 'Checked every word', by: OPERATOR, revision: flagged.hash },
    });
    expect(() => records.startTurn({ text: 'More', operator: OPERATOR, now: NOW })).toThrow('approved');
    expect(() => records.review({ ...review, revision: flagged.hash, acknowledgeFlags: true })).toThrow(
      'already approved',
    );
  });

  test('a revision with blocking issues cannot be approved; a rejected draft has nothing to export', async () => {
    const records = draft();
    const bad = { ...(await mockRevision()), issues: ['Item "x": repeats a round in the lesson.'] };
    await turn(records, bad);
    const review = { note: 'No', operator: OPERATOR, now: NOW, revision: bad.hash, acknowledgeFlags: true };
    expect(() => records.review({ ...review, decision: 'approved' })).toThrow('issues that block approval');
    records.review({ ...review, decision: 'rejected' });
    expect(records.snapshot()?.status).toBe('rejected');
    expect(records.exportBank()).toBeUndefined();
  });

  test('the index lists drafts newest first', () => {
    const index = new DraftIndex(sqliteExec());
    const summary = {
      objective: 'little-word-builders',
      brief: 'x',
      status: 'ready' as const,
      revisionCount: 0,
    };
    index.upsert({ ...summary, id: 'd-a', createdAt: NOW, updatedAt: '2026-10-19T12:00:00Z' });
    index.upsert({ ...summary, id: 'd-b', createdAt: NOW, updatedAt: '2026-10-19T13:00:00Z' });
    index.upsert({
      ...summary,
      id: 'd-a',
      createdAt: NOW,
      updatedAt: '2026-10-19T14:00:00Z',
      status: 'approved',
    });
    expect(index.list().map((draft) => [draft.id, draft.status])).toEqual([
      ['d-a', 'approved'],
      ['d-b', 'ready'],
    ]);
    expect(index.has('d-b')).toBe(true);
    expect(index.has('d-c')).toBe(false);
  });
});

describe('preview escaping: model text never becomes markup', () => {
  test('markup in every model-written field is escaped by the trusted renderer', async () => {
    const revision = await mockRevision({ count: 2 });
    const [first] = revision.bank.items;
    if (first?.kind !== 'choose') throw new Error('expected a choose item');
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    revision.bank.items[0] = {
      ...first,
      prompt: `${evil} A pig says oink.`,
      hints: [evil, `<a href="javascript:alert(3)">x</a>`, 'Choose I.'],
      success: `"><svg onload=alert(4)> You did it.`,
    };
    const html = previewHtml(revision);
    expect(/<script>alert|<img src=x|<svg onload|<a href="javascript/.test(html)).toBe(false);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(4)&gt;');
    // The only script element is the inert JSON document, with markup characters escaped inside it.
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script id="wwm-learning" type="application/json">');
    // No real element carries an event handler (escaped text may still contain the letters "onerror=").
    expect(/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)).toBe(false);
    expect(readLearningHtml(html).activities[0]?.rounds[0]?.prompt).toBe(`${evil} A pig says oink.`);
  });

  test('the preview is a valid learning document with only the revision’s items', async () => {
    const revision = await mockRevision({ count: 10 });
    const path = readLearningHtml(previewHtml(revision));
    expect(path.activities.map((activity) => activity.rounds.length)).toEqual([8, 2]);
    expect(path.title).toContain('not reviewed');
    expect(path.banks).toEqual([]);
  });
});

describe('export → import round trip', () => {
  test('an approved bank exports without operator identity and imports into @wwm/learning', async () => {
    const records = draft();
    const revision = await turn(records);
    records.review({
      decision: 'approved',
      note: 'All six words checked with my son.',
      operator: OPERATOR,
      revision: revision.hash,
      acknowledgeFlags: true,
      now: NOW,
    });
    const file = records.exportBank();
    const json = `${JSON.stringify(file, null, 2)}\n`;
    expect(json).not.toContain(OPERATOR);
    expect(file).toMatchObject({
      format: 'wwm-learning-bank/1',
      objective: 'little-word-builders',
      provenance: { draft: 'd-1', revision: revision.hash, note: 'All six words checked with my son.' },
    });
    const learningSrc = mkdtempSync(join(tmpdir(), 'wwm-bank-'));
    const imported = importBank(JSON.parse(json), { learningSrc, path: baselinePath });
    expect(imported).toMatchObject({ status: 'written', items: 6, objective: 'little-word-builders' });
    expect(JSON.parse(readFileSync(imported.file, 'utf8'))).toEqual(file);
    expect(readFileSync(join(learningSrc, 'banks/index.ts'), 'utf8')).toContain(
      "import littleWordBuilders from './little-word-builders.json' with { type: 'json' };",
    );
    expect(importBank(JSON.parse(json), { learningSrc, path: baselinePath }).status).toBe('unchanged');
    // The baseline accepts the bank in place of nothing.
    const path = parseLearningPath({
      ...baselinePath,
      banks: [...(baselinePath.banks ?? []), { objective: 'little-word-builders', items: file?.items ?? [] }],
    });
    expect(path.banks?.find((bank) => bank.objective === 'little-word-builders')).toBeTruthy();
  });

  test('a tampered export is refused by the import', async () => {
    const records = draft();
    const revision = await turn(records);
    records.review({
      decision: 'approved',
      note: 'ok',
      operator: OPERATOR,
      revision: revision.hash,
      acknowledgeFlags: true,
      now: NOW,
    });
    const file = structuredClone(records.exportBank());
    const lesson = baselinePath.activities.find((activity) => activity.id === 'little-word-builders');
    file?.items.push({ ...(lesson?.rounds[0] as Round), id: 'i-copy' });
    expect(() => checkBank(file, baselinePath)).toThrow(BankImportError);
  });
});
