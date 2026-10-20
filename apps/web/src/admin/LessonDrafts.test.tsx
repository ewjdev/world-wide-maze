import type { DraftRevision, DraftSnapshot } from '@wwm/learning';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { lessonApi, PreviewFrame, ReviewForm, RevisionReport, Transcript } from './LessonDrafts.tsx';

afterEach(() => vi.unstubAllGlobals());

const evil = '<script>alert(1)</script>';
const draft: DraftSnapshot = {
  id: 'd-00000000-0000-4000-8000-000000000000',
  objective: 'little-word-builders',
  brief: `Animals ${evil}`,
  status: 'ready',
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z',
  revisionCount: 1,
  latest: '0123456789abcdef0123456789abcdef',
  createdBy: 'operator@example.com',
  turn: 1,
  messages: [
    { seq: 1, role: 'operator', author: 'operator@example.com', text: 'Animals', at: '2026-10-19T12:00:00Z' },
    { seq: 2, role: 'agent', text: `Turn 1: 1 passed (${evil}).`, at: '2026-10-19T12:00:01Z' },
  ],
  revisions: [],
};
const revision: DraftRevision = {
  hash: '0123456789abcdef0123456789abcdef',
  turn: 1,
  createdAt: '2026-10-19T12:00:01Z',
  objective: 'little-word-builders',
  bank: { objective: 'little-word-builders', items: [] },
  added: [],
  dropped: [],
  items: [
    {
      draftId: 'g1',
      label: '',
      ok: false,
      added: false,
      issues: [`prompt: ${evil}`],
      flags: [],
      raw: { id: 'g1', prompt: evil },
    },
  ],
  issues: [],
  flags: [
    'Item "i-1": Distractor also spells a real word (PEG); the meaning sentence and audio must decide.',
  ],
  calls: [{ kind: 'generate', model: 'claude-sonnet-5-5', inputTokens: 900, outputTokens: 1200 }],
  summary: `Turn 1: asked for 1 new item. ${evil}`,
  promptVersion: 'lesson-draft-v1',
  vocabulary: 'en-cvc-starter',
};

describe('lesson drafts view', () => {
  test('model text is shown as escaped text, never markup', () => {
    const html = renderToString(
      <>
        <Transcript draft={draft} />
        <RevisionReport draft={draft} revision={revision} previewUrl="/preview" onReviewed={() => {}} />
      </>,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Reviewer flags');
    expect(html).toContain('Distractor also spells a real word (PEG)');
    // No preview frame until the operator opens it; and no frame at all for an empty bank.
    expect(html).not.toContain('<iframe');
  });

  test('the preview frame is sandboxed with no permissions', () => {
    const html = renderToString(<PreviewFrame url="/api/admin/lessons/d/revisions/h/preview" />);
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  test('approval starts disabled and needs a note and an acknowledgement of the flags', () => {
    const html = renderToString(
      <ReviewForm
        draft={draft}
        revision={{ ...revision, bank: { objective: 'little-word-builders', items: [{} as never] } }}
        latest
        onReviewed={() => {}}
      />,
    );
    expect(html).toContain('I have read the <!-- -->1<!-- --> reviewer flag');
    expect(html).toMatch(/<button type="button" class="admin-primary" disabled="">Approve this revision/);
    expect(html).toContain('required=""');
  });

  test('messages post same-origin JSON to the draft, with no other credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: draft.id }));
    vi.stubGlobal('fetch', fetchMock);
    await lessonApi.message(draft.id, { text: 'Six more', count: 6, drop: ['i-000000000001'] });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/lessons/${draft.id}/messages`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ text: 'Six more', count: 6, drop: ['i-000000000001'] }),
      }),
    );
    expect(lessonApi.exportUrl(draft.id)).toBe(`/api/admin/lessons/${draft.id}/export`);
  });
});
