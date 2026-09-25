/**
 * Question guardrails (Phase 15): prompt-injection stripping, normalisation for the answer cache, and the
 * on-topic check behind `QUESTION_REJECTED`. Pure functions, unit-tested in test/docent.test.ts.
 */
import { type SearchHit, tokenize } from '@wwm/docent-index';

/**
 * Clauses that try to steer the model rather than ask about the project. Matching clauses are removed from the
 * retrieval query and from the question the model sees; the rest of the question is still answered.
 */
const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.?!\n]{0,40}\b(instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|constraints?|context|everything)\b/i,
  /\b(system|developer|hidden|initial|original)\s+(prompt|message|instructions?)\b/i,
  /\b(reveal|print|show|repeat|output|leak|dump)\b[^.?!\n]{0,30}\b(prompt|instructions?|rules|configuration|secrets?|api\s*keys?)\b/i,
  /\byou\s+are\s+(now|no\s+longer)\b/i,
  /\b(act|behave|respond|answer)\s+as\s+(if|an?|the)\b/i,
  /\b(pretend|roleplay|role-play|jailbreak|dan\s+mode|developer\s+mode)\b/i,
  /\bnew\s+(instructions?|rules?|persona)\b/i,
  /\bwithout\s+(citations?|sources?|restrictions?|limits?)\b/i,
  /\bdo\s+not\s+(cite|use\s+the\s+(sources|excerpts))\b/i,
  /(以前|前)の(指示|命令)を(無視|忘れ)/,
  /システムプロンプト/,
];

/** Control characters, zero-width and bidi-override characters (built from code points: ASCII-only source). */
const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x08],
    [0x0b, 0x1f],
    [0x7f, 0x7f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([a, b]) => `\\u{${(a as number).toString(16)}}-\\u{${(b as number).toString(16)}}`)
    .join('')}]`,
  'gu',
);

export interface SanitizedQuestion {
  /** The question with injection clauses, markup and control characters removed. */
  clean: string;
  /** Something was removed as an injection attempt. */
  injection: boolean;
  removed: string[];
}

/** Split into sentence-ish clauses, keeping the delimiter with the clause. */
function clauses(s: string): string[] {
  return s.match(/[^.?!。？！;\n]+[.?!。？！;\n]*/g) ?? [];
}

export function sanitizeQuestion(raw: string): SanitizedQuestion {
  const removed: string[] = [];
  let s = raw
    .normalize('NFKC')
    .replace(INVISIBLE, ' ')
    .replace(/```[\s\S]*?(```|$)/g, (m) => {
      removed.push(m);
      return ' ';
    })
    .replace(/<\/?[a-z_][\w:-]*[^>]*>/gi, (m) => {
      removed.push(m);
      return ' ';
    });
  const kept: string[] = [];
  for (const c of clauses(s)) {
    if (INJECTION.some((re) => re.test(c))) removed.push(c.trim());
    else kept.push(c);
  }
  s = kept.join(' ').replace(/\s+/g, ' ').trim();
  return { clean: s, injection: removed.length > 0, removed };
}

/** Cache key text: lowercase, NFKC, punctuation and repeated spaces removed. */
export function normalizeQuestion(q: string): string {
  return q
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Words (after tokenizing) that tie a question to this project. A question with none of these still passes when
 * retrieval finds a strong match; otherwise it is rejected as unrelated.
 */
const LEXICON = new Set(
  tokenize(
    'maze wwm 2013 original rebuild rebuilt tribute revival saqoosha party google chrome experiment experiments ' +
      'katamari futurek aid dcc wwmmm kaisoku phase phases agent agents ai claude opus model build built builder ' +
      'log logs stage stages island islands bridge bridges ball phone smartphone controller tilt evidenced ' +
      'reconstructed credit credits team made creator creators docent website websites page capture physics ' +
      'rapier ammo three renderer score scores scoring item items elevator elevators rail rails goal pairing ' +
      'award awards webby archive bundle fidelity cloudflare worker workers solver leaderboard ranking replay ' +
      'phantomjs opencv socket websocket installation dotfes lions oculus song timeline history launch shutdown ' +
      'contract contracts research dossier human humans playtest iphone android keyboard gamepad jump power ' +
      'lives timer map texture engine webgpu three.js orchestrator gate wave play played player players ' +
      'level levels programmer programmers engineer engineers designer designers developer developers director ' +
      '迷路 メイズ ワールドワイドメイズ グーグル 快速東京 原作 再現 オリジナル',
  ),
);

export interface TopicCheck {
  onTopic: boolean;
  lexicon: string[];
  topScore: number;
}

/** BM25 score above which a question counts as on-topic even without a lexicon word. */
export const STRONG_MATCH = 9;

export function topicCheck(clean: string, hits: SearchHit[]): TopicCheck {
  const lexicon = [...new Set(tokenize(clean))].filter((t) => LEXICON.has(t));
  const top = hits[0];
  const topScore = top?.score ?? 0;
  const strong = !!top && topScore >= STRONG_MATCH && top.matched.length >= 2;
  return { onTopic: lexicon.length > 0 || strong, lexicon, topScore };
}
