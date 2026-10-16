# Five more lessons for ages 4–5

Original pilot material for a child playing with a grown-up. Each lesson has four required rounds, three hints per round, a fifth optional bonus, and an off-screen activity. These are practice activities awaiting educator and family review.

| Lesson | Activity ID | Practice |
| --- | --- | --- |
| Hola, Pip! | `spanish-hello` | Say hola, adiós, gracias, and optionally por favor; match each to its meaning. |
| Colores with Pip | `spanish-colors` | Say rojo, azul, verde, and optionally amarillo; find a colored shape. |
| Uno, dos, tres | `spanish-counting` | Say uno, dos, tres, and optionally cuatro; match a small group, then revisit a number with different objects. |
| Little word builders | `little-word-builders` | Hear CAT, SUN, MAP, DOG; choose one missing letter, then revisit CAT with a different blank. |
| Build Spanish words | `spanish-word-builders` | Say SOL (sun), PAN (bread), OSO (bear), SAL (salt); choose one missing letter, then revisit SOL. |

## Play and load

Run `pnpm dev:education` and open `/lessons/<activity-id>/`. All eleven lessons are selectable from the learning home page. The five new lessons use tap or arrow controls so the keyboard's answer-position letters do not compete with the spelling letters.

Each new lesson page offers **Download this lesson for the maze**. The generator writes five self-contained, readable HTML packs to `apps/education/public/lesson-packs/`; the education build copies them to `apps/education/dist/lesson-packs/`. Each pack declares exactly one activity so the game's **Load learning HTML** control selects that lesson by default. The portable file is data and teaching notes; the game provides interaction and audio. Use an updated game build with these schema additions.

The updated game also accepts `/play/practice?learn=<activity-id>` for each new lesson. These links refer to the running local or deployed build; creating these files does not deploy them.

## Voice and spelling

The round's `practice` is a separate, language-tagged model. English instructions use English audio; Spanish models select an installed Spanish browser voice (Spain preferred, other Spanish locales accepted). Missing Spanish voices never fall back to an English voice. The transcript remains visible, with a grown-up fallback message and a **Hear the word** control. Browser voice quality and availability depend on the device; no new studio recordings are included.

Speaking is listen-and-repeat, optional and unscored. No microphone permission, recording, speech recognition, or upload is used. A correct tap checks the displayed choice only. Spelling uses uppercase letters, a visible blank, and adult modeling; independent reading is not assumed.

Content is in `packages/learning/src/preschool.ts`. Baseline revision `3.1.0` appends five lessons to the six math lessons. Older six-lesson family introduction backups restore their existing text while the new lessons retain their default introductions. The schema remains `wwm-learning/0.3`, extended with `language`/`literacy` domains, optional localized `practice`, optional text stimulus, and text-only options. Older strict readers reject these additions rather than silently dropping them.

Verification covers all 25 rounds on desktop and mobile Chromium, correct/wrong answers, hints, optional rounds, localized word replay, silent Spanish fallback, portable import, escaping, and old family backups. Device speech is stubbed in browser tests; native pronunciation and child playtesting remain separate acceptance work.
