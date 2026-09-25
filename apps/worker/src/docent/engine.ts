/**
 * The docent pipeline (contracts §10.3), free of Worker bindings so the route, the tests and the eval runner
 * share it: sanitise → retrieve → topic check → model (streamed through the grounding gate) → citations.
 * Caching, rate limits and the SSE transport live in routes/docent.ts.
 */
import { type Searcher, terms } from '@wwm/docent-index';
import type { DocentCitation, DocentEvent, DocentRequest } from '@wwm/schema';
import { CitationStream } from './grounding.ts';
import { sanitizeQuestion, topicCheck } from './guard.ts';
import { buildMessages, DONT_KNOW, SYSTEM_PROMPT } from './prompt.ts';
import type { DocentProvider, ProviderResult } from './providers.ts';
import { type Excerpt, retrieve, selectExcerpts } from './retrieve.ts';

export type Outcome = 'answered' | 'dont_know' | 'rejected' | 'error';

export interface DocentRun {
  outcome: Outcome;
  text: string;
  citations: DocentCitation[];
  /** Why the answer is a "don't know": the model said so, or it failed the grounding check. */
  reason?: 'model' | 'ungrounded' | 'refusal' | 'no_excerpts';
  injection: boolean;
  /** Retrieved chunk ids, best first (for the eval). */
  retrieved: string[];
  result?: ProviderResult;
}

export interface EngineDeps {
  searcher: Searcher;
  provider: DocentProvider;
  maxTokens: number;
  signal?: AbortSignal;
}

export const REJECTED_MESSAGE =
  'I can only answer questions about World Wide Maze: the 2013 original and how this tribute was rebuilt.';

export function toCitation(e: Excerpt): DocentCitation {
  const c = e.chunk;
  return {
    title: c.title,
    path: c.path,
    ...(c.anchor ? { anchor: c.anchor } : {}),
    ...(c.url ? { url: c.url } : {}),
  };
}

/** Everything decided before any model call (cheap: no network). */
export interface Prepared {
  /** The question with injection clauses removed: what is searched, cached and sent to the model. */
  question: string;
  injection: boolean;
  history: NonNullable<DocentRequest['history']>;
  rejected: boolean;
  excerpts: Excerpt[];
  retrieved: string[];
  /** Question words that appear nowhere in the corpus (the mock treats these as "not covered"). */
  unknownTerms: string[];
}

export function prepareDocent(req: DocentRequest, searcher: Searcher): Prepared {
  const q = sanitizeQuestion(req.question);
  const history = (req.history ?? []).map((h) =>
    h.role === 'user' ? { role: h.role, text: sanitizeQuestion(h.text).clean } : h,
  );
  const previous = [...history].reverse().find((h) => h.role === 'user')?.text;
  const hits = q.clean ? retrieve(searcher, q.clean, previous) : [];
  const topic = topicCheck(q.clean, hits);
  return {
    question: q.clean,
    injection: q.injection,
    history,
    rejected: !q.clean || !topic.onTopic,
    excerpts: selectExcerpts(hits),
    retrieved: hits.map((h) => h.chunk.id),
    // Latin-script words only: the corpus is English, so a Japanese phrase ("日本語で") says nothing about coverage
    unknownTerms: terms(q.clean).filter((t) => /^[a-z0-9]+$/.test(t) && !searcher.knows(t)),
  };
}

export async function runDocent(
  req: DocentRequest,
  deps: EngineDeps,
  emit: (e: DocentEvent) => void,
): Promise<DocentRun> {
  return answerDocent(prepareDocent(req, deps.searcher), deps, emit);
}

export async function answerDocent(
  p: Prepared,
  deps: Omit<EngineDeps, 'searcher'>,
  emit: (e: DocentEvent) => void,
): Promise<DocentRun> {
  const base = { injection: p.injection, retrieved: p.retrieved };
  if (p.rejected) {
    emit({ type: 'error', code: 'QUESTION_REJECTED', message: REJECTED_MESSAGE });
    return { ...base, outcome: 'rejected', text: '', citations: [] };
  }

  const { excerpts, history } = p;
  const q = { clean: p.question };
  const byRef = new Map(excerpts.map((e) => [e.ref, e]));
  const stream = new CitationStream(new Set(byRef.keys()), (text) => emit({ type: 'delta', text }));

  let result: ProviderResult | undefined;
  if (excerpts.length) {
    result = await deps.provider.stream(
      {
        system: SYSTEM_PROMPT,
        messages: buildMessages(q.clean, excerpts, history),
        excerpts,
        unknownTerms: p.unknownTerms,
        question: q.clean,
        maxTokens: deps.maxTokens,
        ...(deps.signal ? { signal: deps.signal } : {}),
      },
      (t) => stream.push(t),
    );
  }
  const g = stream.finish();

  if (result?.stopReason === 'refusal' || !g.grounded) {
    // Not grounded (or refused): nothing was shown unless it was an explicit "don't know".
    const reason = !excerpts.length
      ? 'no_excerpts'
      : result?.stopReason === 'refusal'
        ? 'refusal'
        : g.dontKnow
          ? 'model'
          : 'ungrounded';
    let text = g.text;
    if (!g.emitted || reason === 'refusal') {
      text = DONT_KNOW;
      if (!g.emitted) emit({ type: 'delta', text });
    }
    emit({ type: 'citations', items: [] });
    emit({ type: 'done' });
    return { ...base, outcome: 'dont_know', reason, text, citations: [], ...(result ? { result } : {}) };
  }

  let text = g.text;
  if (result?.stopReason === 'max_tokens') {
    emit({ type: 'delta', text: '…' });
    text += '…';
  }
  const citations = g.cited.map((ref) => toCitation(byRef.get(ref) as Excerpt));
  emit({ type: 'citations', items: citations });
  emit({ type: 'done' });
  return { ...base, outcome: 'answered', text, citations, ...(result ? { result } : {}) };
}
