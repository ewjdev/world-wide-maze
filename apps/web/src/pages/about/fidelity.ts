/**
 * The evidenced / reconstructed / new table on /about is generated from docs/reference/fidelity-spec.md at build
 * time, so it can never drift from the spec the game was built against.
 */
import specRaw from '../../../../../docs/reference/fidelity-spec.md?raw';

export type Mark = 'E' | 'R' | 'N';

export interface FidelityRow {
  feature: string;
  was: string;
  /** Labels found in the spec's "Label · source" cell, in order (E, R, N). Empty for "—" (no 2013 counterpart). */
  marks: Mark[];
  /** The source part of the label cell (markdown). */
  source: string;
  now: string;
  /** The rebuild column flags an addition "(N)" of its own. */
  nowAddsNew: boolean;
}

export interface FidelitySection {
  id: string;
  title: string;
  rows: FidelityRow[];
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** Labels in a cell: standalone E/R/N tokens outside `code`. */
export function marksIn(cell: string): Mark[] {
  const plain = cell.replace(/`[^`]*`/g, ' ');
  const out: Mark[] = [];
  for (const m of plain.matchAll(/(?:^|[\s/·(,;])([ERN])(?=$|[\s·(),;:/])/g)) {
    const k = m[1] as Mark;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

export function parseFidelitySpec(md: string): { sections: FidelitySection[]; openQuestions: string[] } {
  const sections: FidelitySection[] = [];
  const openQuestions: string[] = [];
  let current: FidelitySection | null = null;
  let inOpen = false;
  let header: string[] | null = null;
  for (const line of md.split('\n')) {
    const h = /^##\s+(\d+)\.\s+(.+)$/.exec(line);
    if (h) {
      const title = (h[2] ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
      inOpen = /open questions/i.test(title);
      current = inOpen ? null : { id: `f-${h[1]}`, title, rows: [] };
      if (current) sections.push(current);
      header = null;
      continue;
    }
    if (inOpen) {
      const q = /^\d+\.\s+(.+)$/.exec(line.trim());
      if (q?.[1]) openQuestions.push(q[1]);
      continue;
    }
    if (!current || !line.trim().startsWith('|')) {
      header = null;
      continue;
    }
    const c = cells(line);
    if (!header) {
      header = c;
      continue;
    }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue;
    const labelIdx = header.findIndex((x) => /label/i.test(x));
    if (labelIdx < 0 || c.length < 4) continue;
    // "E · source", "R (derived)", "E (data) / R (phone UI)", "E (Bullet default) · R (not overridden)", "—".
    const [first = '', ...rest] = (c[labelIdx] ?? '').split('·').map((x) => x.trim());
    const marks = marksIn(first);
    const source: string[] = [];
    for (const seg of rest) {
      const lead = /^([ERN])\s*\(/.exec(seg)?.[1] as Mark | undefined;
      if (lead) {
        if (!marks.includes(lead)) marks.push(lead);
      } else source.push(seg);
    }
    current.rows.push({
      feature: c[0] ?? '',
      was: c[1] ?? '',
      marks,
      source: source.join(' · '),
      now: c[labelIdx + 1] ?? '',
      nowAddsNew: /\(N\b|\bN\)|^N\b/.test(c[labelIdx + 1] ?? ''),
    });
  }
  return { sections, openQuestions };
}

export const FIDELITY = parseFidelitySpec(specRaw);

export function markCounts(sections: FidelitySection[]): Record<Mark | 'none', number> {
  const n = { E: 0, R: 0, N: 0, none: 0 };
  for (const s of sections)
    for (const r of s.rows) {
      if (r.marks.length === 0) n.none++;
      for (const m of r.marks) n[m]++;
    }
  return n;
}
