/**
 * Lexical tokenizer shared by the index build and the Worker's retrieval: lowercase, split on anything that is
 * not a letter or digit, drop English stopwords, light suffix stripping (plural, -ing, -ed), and CJK runs as
 * character bigrams so Japanese names in the corpus (快速東京) still match.
 */

const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does doing for from had has have how i if in into is it ' +
    'its me my no not of on or our so than that the their them then there these they this those to too was we ' +
    'were what when where which who whom why will with would you your about also any all just only over such ' +
    'very tell please explain describe much many more most some other there here s t'
  ).split(' '),
);

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

/** Crude English stemmer: enough to match "islands"/"island", "built"/"build" is left alone. */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

/** Tokens in order (duplicates kept, for term frequency). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const parts = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u);
  for (const p of parts) {
    if (!p) continue;
    if (CJK.test(p)) {
      // split mixed runs into CJK and non-CJK pieces
      for (const seg of p.match(/[぀-ヿ㐀-鿿豈-﫿]+|[^぀-ヿ㐀-鿿豈-﫿]+/g) ?? []) {
        if (CJK.test(seg)) {
          if (seg.length === 1) out.push(seg);
          for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2));
        } else if (!STOP.has(seg)) out.push(stem(seg));
      }
      continue;
    }
    if (STOP.has(p)) continue;
    if (p.length === 1 && !/\d/.test(p)) continue;
    out.push(stem(p));
  }
  return out;
}

/** Distinct tokens. */
export function terms(text: string): string[] {
  return [...new Set(tokenize(text))];
}
