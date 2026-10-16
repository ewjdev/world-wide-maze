# WWM Learning

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Parents selecting and personalizing a default learning path; children ages 4–6 playing the original early-math activities alongside a grown-up. Five Spanish and spelling activities are designed for ages 4–5 with adult support. Age is a suggested audience, not an assessment or a restriction.

## Product Purpose

Publish useful, child-friendly education pages with explicit learning intent that compatible games can read. Keep education, game mechanics, and learner history separate.

## Operating Context

The parent starts with baseline material, uses AI to propose a personal spin, reviews it, and accepts a family fork. This workflow and the initial age range were confirmed in the September 26 conversation. WWM is the first intended game consumer.

## Capabilities and Constraints

The static-site pilot contains eleven activities: the original six early-math activities, plus Spanish greetings, Spanish colors, Spanish counting, supported English spelling, and supported Spanish spelling. Each new activity has four core rounds and an optional fifth stretch. Transparent parent notes, versioned HTML data, local customization, and a bring-your-own-AI prompt/import workflow accompany the material. These activities are practice rather than a complete curriculum or an assessment of mastery.

The new activities show a written word model and a "Hear the word" replay control. They use browser speech; Spanish models require an available Spanish browser/device voice. When one is unavailable, the transcript remains available for a Spanish-speaking grown-up to read together. Repeating aloud is optional, unrecorded, and unscored. The existing generated voice manifest covers the original math material; it does not provide Spanish recordings.

Each new activity has a standalone learning HTML pack at `/lesson-packs/<id>.html`, generated into `public/lesson-packs/` and copied to `dist/lesson-packs/` by the education build. Each file contains one activity so the game's file loader selects the lesson named on the download. The current game integration uses the shared `@wwm/learning` baseline and the loader and gate runtime in `apps/web/src/learning`. Deployment and live availability of this extension remain separate and unverified. No accounts, AI-provider integration, cloud learner record, or educational certification are included.

## Product Principles

- A parent can see the same educational intent a game reads.
- Begin with useful default material; personalization is optional.
- Preserve the baseline and make proposed changes reviewable and reversible.
- Activity participation is not evidence of mastery.
- Wrong answers invite help and another attempt; activities remain freely selectable.

## Evidence on Hand

The existing game lives in apps/web. Its Figtree/Unbounded typography and bright geometric color roles provide the incumbent visual system. The starter activities are original pilot content requiring educator and family review, informed by sources recorded in docs/education/content-notes.md. The five additions retain Pip and the Sky Islands lesson canvas; their source is `packages/learning/src/preschool.ts`. Spanish pronunciation on installed device voices and child testing have not been verified.

## Open Decisions

Product name beyond the working label WWM Learning; account ownership; AI provider; published forks; curriculum review; broader age groups and commercial model.
