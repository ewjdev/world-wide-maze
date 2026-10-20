# Item-bank spike, October 19, 2026

Phase 31 milestone M0. The question: can a model write fresh example rounds for an existing objective that pass `@wwm/learning` validation? If so, how much of the output is usable?

## Method

- **Tool:** `pnpm --filter @wwm/lesson-draft spike` (`tools/lesson-draft/src/spike.ts`). Model calls go through a local `wrangler dev` helper Worker to AI Gateway `wwm`; the Anthropic key stays in the gateway.
- **Model:** `claude-sonnet-5-5`, three independent runs per objective, six rounds per run, at most two repair turns.
- **Objectives:** `little-word-builders` (missing letter), `compare-groups` (which island has more) and `spanish-colors` (hear a colour word, tap the shape).
- **Prompt:** the authored activity's required rounds as exemplars, an objective brief and an instruction to write fresh examples. The exemplars must not be repeated.
- **Checks:** `roundSchema`, the expected round kind, no `optional`/`onlyAfterHelpOn`, freshness against the lesson and within the set, plus objective checks the schema can't make:
  - **Spelling:** a three-letter pattern with one blank; the completed word matches `practice.text` and is in `/usr/share/dict/words`; the last hint names the letter.
  - **Compare:** numbers spoken in the worked-example hint and success line must be on the islands; the success line states the larger count.
  - **Colours:** the Spanish word maps to the answer token's colour; options differ in colour; the prompt doesn't give the word away.
- **Usage:** 18,511 input and 25,623 output tokens for all nine runs. Raw output: [results.json](results.json).

## Results

| Objective | Valid on first pass | Valid after repair | Model calls | Distinct items (of 18) | Items in every run |
|---|---|---|---|---|---|
| little-word-builders | 18/18 | 18/18 | 3 | 9 words | PIG, BUS, BED, HAT |
| compare-groups | 17/18 | 18/18 | 4 | 10 count pairs | 5 v 6, 5 v 5 |
| spanish-colors | 18/18 | 18/18 | 3 | 7 word/colour sets | 5 of 7 |

The one first-pass failure repeated an authored round, and one repair turn fixed it. The output also needed human review, which found:

1. **Validity is not the bottleneck; variety is.** Three independent runs converged on the same items. Asking the model again doesn't grow a bank. A bank needs an explicit coverage plan, such as a reviewed word list with exclusions passed to the model, or a deterministic generator.
2. **Parametric objectives don't need a model.** The colour rounds were close to verbatim copies of the exemplar template: four words, three shapes and a fixed prompt. Compare rounds vary only counts, arrangements and sizes. A seeded generator in `@wwm/learning` covers them with unlimited fresh items, its output is fully checkable, and nothing per item needs review. The model's only contribution there was varying a few prompt lines.
3. **Open-vocabulary objectives are where a model helps.** The spelling words and meaning sentences were age-appropriate and well formed: PIG, HEN, CUP, BED, HAT, FOX, PEN, JAM, BUS. Appropriateness still needs a curated list or human review. The dictionary check accepts obscure words (it flagged BOS, HET and LAT as possible distractor words), so a reviewed age-appropriate word list should replace it.
4. **The authored lesson already has ambiguous distractors.** CAP (C A _ with P), MOP (M _ P with O), SUM, COG and BOG are real words. The meaning sentence and the audio decide the answer, which is acceptable for listen-and-spell practice. A tracking model should know this round type depends on listening.
5. **Prose checks caught nothing, but they are cheap.** The compare check confirmed that every spoken count matched the islands. Keep it as a regression guard for model-written and hand-written rounds.

## Consequences for Phase 31

- Build deterministic generators for parametric objectives (compare, difference, count, colour) before any authoring agent.
- Use the authoring agent for open-vocabulary banks and new lesson drafts. Give it the bank so far as an exclusion list and a reviewed word list as its vocabulary, and send its output through human review.
- Keep `@wwm/learning` as the only validator. Objective checks live beside the generators so hand-written, generated and model-written rounds all pass the same gate.

## Limits

- **Small sample:** three runs of one model on three objectives. The pass rates don't predict other objectives or new lesson types.
- **Not a learning review:** no educator or child reviewed the rounds.
- **No sampling settings:** the gateway call used defaults, and temperature was not varied.
