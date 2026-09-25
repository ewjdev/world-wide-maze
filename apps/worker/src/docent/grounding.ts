/**
 * Streaming citation handling and the grounding post-check (Phase 15 task 3).
 *
 * The model cites excerpts as `[S3]`. `CitationStream` rewrites those markers on the fly into display numbers
 * `[1]`, `[2]`… in order of first use (unknown ids are dropped), and **holds all text back until the answer is
 * grounded**: until a valid citation or the "don't know" sentence has appeared, nothing reaches the visitor. If the
 * answer ends without either, nothing unverified was shown and the caller replaces it with the "don't know" reply.
 */
import { DONT_KNOW, DONT_KNOW_JA } from './prompt.ts';

const MARKER = /\[\s*S\d+(?:\s*[,;]\s*S?\d+)*\s*\]/g;
/** A possibly unfinished marker at the end of the buffer (`[`, `[S`, `[S1,`…). */
const PARTIAL = /\[\s*(?:S\d*(?:\s*[,;]\s*S?\d*)*)?\s*$/;

const fold = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

/** The answer states that the sources don't cover the question. */
export function isDontKnow(text: string): boolean {
  const t = fold(text);
  return (
    t.includes(fold(DONT_KNOW)) ||
    t.includes(fold(DONT_KNOW_JA)) ||
    /\bthe sources (do not|don't|doesn't) cover (that|this)\b/.test(t)
  );
}

export interface GroundedResult {
  /** Final display text (markers rewritten). */
  text: string;
  /** Excerpt refs (`S3`) in display order: display number n = index + 1. */
  cited: string[];
  grounded: boolean;
  dontKnow: boolean;
  /** Anything was passed to `emit` (the gate opened). */
  emitted: boolean;
}

export class CitationStream {
  #raw = ''; // unprocessed input (may end in a partial marker)
  #held = ''; // processed text waiting for the gate
  #out = ''; // everything processed
  #open = false;
  readonly #cited: string[] = [];
  private readonly validRefs: ReadonlySet<string>;
  private readonly emit: (text: string) => void;

  constructor(validRefs: ReadonlySet<string>, emit: (text: string) => void) {
    this.validRefs = validRefs;
    this.emit = emit;
  }

  #rewrite(chunk: string): string {
    return chunk.replace(MARKER, (m) => {
      const nums = [...m.matchAll(/\d+/g)].map((x) => `S${x[0]}`);
      let out = '';
      for (const ref of nums) {
        if (!this.validRefs.has(ref)) continue;
        let n = this.#cited.indexOf(ref);
        if (n < 0) n = this.#cited.push(ref) - 1;
        if (!out.includes(`[${n + 1}]`)) out += `[${n + 1}]`;
      }
      return out;
    });
  }

  #deliver(processed: string): void {
    if (!processed) return;
    this.#out += processed;
    if (this.#open) {
      this.emit(processed);
      return;
    }
    this.#held += processed;
    if (this.#cited.length > 0 || isDontKnow(this.#held)) {
      this.#open = true;
      const h = this.#held;
      this.#held = '';
      this.emit(h);
    }
  }

  push(text: string): void {
    this.#raw += text;
    const partial = PARTIAL.exec(this.#raw);
    const cut = partial && this.#raw.length - partial.index <= 24 ? partial.index : this.#raw.length;
    const ready = this.#raw.slice(0, cut);
    this.#raw = this.#raw.slice(cut);
    this.#deliver(this.#rewrite(ready));
  }

  finish(): GroundedResult {
    // an unfinished marker at the very end is dropped
    this.#deliver(this.#rewrite(this.#raw).replace(PARTIAL, ''));
    this.#raw = '';
    const text = this.#out.replace(/[ \t]+\n/g, '\n').trim();
    return {
      text,
      cited: [...this.#cited],
      grounded: this.#cited.length > 0,
      dontKnow: this.#cited.length === 0 && isDontKnow(text),
      emitted: this.#open,
    };
  }
}
