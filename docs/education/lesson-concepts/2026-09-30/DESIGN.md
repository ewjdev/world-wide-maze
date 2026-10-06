---
name: Pip's next adventures — lesson review
description: An independent illustrated review gallery for ten ages-4–6 lesson concepts.
colors:
  ink: "#20262d"
  muted: "#4b555f"
  fog-white: "#f8f8f8"
  paper: "#ffffff"
  line: "#d6dce0"
  focus-blue: "#2d6fa3"
  link-teal: "#206a71"
  action-green: "#286c36"
  action-green-hover: "#1d5429"
  pale-blue: "#e7eef5"
  pale-green: "#e2eddf"
  retry-yellow: "#fff5d8"
  retry-border: "#856300"
  secondary: "#e9edef"
  secondary-hover: "#dce3e7"
  choice-border: "#cbd8e2"
  field-border: "#89959e"
  current-category-ink: "#245779"
  pip-shell: "#dfe3e6"
  pip-seam: "#456e93"
typography:
  display:
    fontFamily: "Unbounded, sans-serif"
    fontSize: "clamp(26px, 3vw, 42px)"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Unbounded, sans-serif"
    fontSize: "clamp(22px, 2.3vw, 32px)"
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Figtree, sans-serif"
    fontSize: "17px"
    lineHeight: 1.55
  supporting-title:
    fontFamily: "Figtree, sans-serif"
    fontSize: "21px"
    lineHeight: 1.4
rounded:
  control: "8px"
  diagram: "10px"
  image-and-choice: "12px"
  question-panel: "16px"
spacing:
  tight: "8px"
  action-gap: "10px"
  choice-gap: "12px"
  copy: "16px"
  mobile-gutter: "20px"
  section-gap: "24px"
  workbench-gap: "32px"
  page-gutter: "36px"
components:
  button-primary:
    backgroundColor: "{colors.action-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-green-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  answer-choice:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.image-and-choice}"
    padding: "14px"
  question-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.question-panel}"
    padding: "26px"
---

# Design System: Pip’s next adventures — lesson review

## Overview

**Creative North Star: "Illustrated worlds, inspectable teaching"**

This names the built gallery’s composition: begin with story illustrations, then inspect exact question scenes and their teaching rationale. The audience is an adult reviewing lesson directions for children aged 4–6. The gallery offers a preview of authored choices, explanations, and hints; it does not measure a child’s learning.

Visual authority comes from [index.template.html](index.template.html). The incumbent [education design system](../../../../apps/education/DESIGN.md) and [Sky Islands theme](../../../../packages/learning/src/theme.ts) establish the lineage: fog-white daylight, geometric display type, readable body type, and silver-gray Pip with dark oval eyes, blue curved seams, and a smile. This packet carries that world into subject-specific illustrations without importing the game or learning runtime. [BRIEF.md](BRIEF.md) defines the asset and content contract; [README.md](README.md) describes use and boundaries.

The subject order is rockets, cars, trains, letters, words, shapes, colors, animals, plants, and weather. [build.mjs](build.mjs) embeds available lesson JSON into the generated `index.html`; the overview count and [manifest.json](manifest.json) reflect that build’s inventory. This design record does not certify that every pending asset has arrived or that the final gallery has passed browser checks.

**Key Characteristics:**

- Illustration-first overview with the learning goal on every lesson card.
- A consistent Pip and daylight setting across distinct subject worlds.
- Large static question diagrams, separate from atmospheric concept art.
- Adult teaching notes beside the question preview and review decisions below it.
- Freely navigable questions, persistent written explanations, and local review notes.

## Colors

The gallery preserves the education surface’s calm neutral base. Frontmatter records the implemented interface colors; subject diagrams and illustrations carry their own literal object colors.

### Primary

**Action Green** marks the next-question action, correct-choice borders, and successful feedback. **Focus Blue** marks keyboard focus and hovered-choice borders. **Link Teal** marks links, quiet actions, and overview review decisions.

### Secondary

**Pale Blue** marks the selected category and choice hover surfaces. **Pale Green** supports the child takeaway and successful-answer explanation. **Retry Yellow** and **Retry Border** show another attempt alongside written guidance. The neutral **Secondary** pair supports ordinary navigation and inspection actions.

### Neutral

**Fog White** is the page and diagram surround; **Paper** is the question canvas, answer choices, and fields. **Ink** carries primary content and selected question tabs. **Muted** carries context and caveats. **Line** separates page regions; **Choice Border** and **Field Border** distinguish controls. **Pip Shell** and **Pip Seam** preserve the mascot’s established appearance in the masthead.

**The Evidence Rule.** Feedback uses explanatory text as well as color. An unassisted diagram must not mark the correct answer through a special arrow, highlight, or unequal styling. A lesson’s `accent` is currently assigned to a CSS property when opened, but the gallery chrome does not consume it; do not describe the navigation as individually color-coded by category.

## Typography

The gallery loads local variable-font files from `assets/figtree.woff2` and `assets/unbounded.woff2` with font swapping. Both declarations cover weights 300–900. Unbounded supplies the geometric overview and lesson headings; Figtree carries prose, choices, navigation, forms, and the smaller teaching headings.

The frontmatter defines the base hierarchy. Lesson-card titles use Unbounded at 23px, reducing to 19px at the tablet/mobile breakpoint and returning to 23px in the single-column phone layout. Question prompts use Unbounded with a `clamp(22px, 2.25vw, 30px)` size and a 28ch measure; the phone rule fixes them at 23px and removes the reserved minimum height. Overview lead copy is 19px, becoming 17px on mobile. Lesson introductory copy is 18px with a 58ch measure; teaching-plan body text is 16px with a 66ch measure. Supporting text generally sits at 13–16px.

**The Stimulus Rule.** Exact instructional letters belong in authored SVG diagrams. They are not generated in concept art. The [letters lesson](lessons/letters/lesson.json) deliberately compares conventional serif and sans-serif glyphs; those SVG font fallbacks are a lesson-specific stimulus and still need target-device verification before child delivery.

## Layout

The masthead and page share a maximum width of 1480px. Desktop page padding is 36px; the masthead uses 26px top, 36px side, and 22px bottom padding. The overview places the introductory text opposite the concept/question count, then displays image-led cards in a three-column grid with 32px row and 24px column gaps. The first three concept images load eagerly; subsequent ones are lazy-loaded.

Opening a lesson replaces the overview with a workbench. Its desktop category rail is 190px wide, with a 32px gap to the flexible content area. The lesson header leads into a two-column summary: concept illustration beside the learning goal, story, and tinted child takeaway. The question area pairs a flexible white activity panel with a 290px teaching-notes column, separated by 28px. The teaching plan and review form follow in two equal columns.

| Source breakpoint | Implemented behavior |
| --- | --- |
| 1600px and above | Overview expands to four columns. |
| 1180px and below | Overview becomes two columns; the category rail narrows to 155px with a 24px gap. Teaching notes move below the question panel in two columns. |
| 760px and below | Masthead wraps; page gutters become 20px. The category rail becomes a labeled select. Lesson summary, teaching notes, and bottom sections stack. Question panel padding becomes 20px by 16px; controls and question tabs wrap. |
| 480px and below | Overview becomes one column. Card imagery uses a slightly wider crop. Read-aloud control moves below the round heading; the question panel extends 6px into the gutters. |
| Print | Navigation, controls, tabs, review fields, and lesson links hide. The workbench stacks; concept and question images are capped at 450px and 600px. The overview uses two columns. |

The SVG scene preserves its 800:440 aspect ratio through `object-fit: contain`; it scales to available width rather than changing instructional geometry. The page permits vertical scrolling so adults can inspect questions and their surrounding rationale. These are source-defined responsive rules, not a claim of completed device acceptance.

## Elevation & Depth

The interface uses no box shadows. White question surfaces, pale takeaway and feedback panels, image boundaries, and thin dividers provide separation. Imagery supplies the richest depth. Hovering an overview image darkens it slightly with a 200ms filter transition; reduced-motion preference removes transitions. Opening a lesson scrolls instantly to the top; changing a question replaces its panel content in place.

## Shapes

Controls and question tabs use softly curved corners (8px). Diagrams and feedback use 10px corners; images, takeaways, and answer choices use 12px; the main question panel uses 16px. Pip’s circular silhouette contrasts with these simple rectangular surfaces. Concept images use a 1.5 aspect ratio and cover cropping, while instructional SVGs retain their full composition.

**The Geometry Rule.** Question diagrams are deterministic 800×440 SVG assets with large objects and clear silhouettes. Their authored geometry governs the prompt and answer key. Preserve their `title`/`desc` text, lesson-specific IDs, readable labels, and the meaningful orientation of rails, shapes, and letters when editing them.

## Components

### Overview cards and category navigation

Each overview card is one borderless button containing a concept illustration, category, review status, lesson title, and observable learning goal. The card copy sits directly on the page instead of inside an additional tinted box. Review status begins as “5 questions” and changes to Keep, Revise, or Discuss when a decision is saved.

Desktop category buttons have a minimum height of 46px. The current category uses Pale Blue, darker blue text, heavier weight, and `aria-current`. On mobile a labeled native select presents the same inventory. Previous/next lesson buttons disable at the ends. Lesson selection updates the URL hash; a matching hash opens that lesson’s first round.

### Story illustration and precise scene

Each lesson summary labels its concept image as story and visual direction. The visible goal, story, and “A child could say or show” panel connect that image to the lesson’s intent. Links open the full README and concept illustration. The separate question scene is an SVG displayed as an image with authored alt text. It does not provide direct dragging or object selection; the answer buttons beneath it perform the preview interaction.

### Question tabs, choices, and feedback

Five question buttons expose the round titles; the current one uses an Ink background, Paper text, and `aria-pressed`. Any question can be opened immediately. Previous/next question controls provide sequential navigation and disable at the first/fifth round. Success does not gate progress, and the fifth question is explicitly marked as optional stretch.

Answer choices use a two-pixel border, a minimum height of 60px, bold centered labels, and wrapping flexible widths. A correct choice displays the authored explanation on Pale Green; another choice displays “Let’s look again” with the next available hint on Retry Yellow. Any choice ID listed in `correctChoiceIds` is accepted individually; the gallery does not require hidden multi-select. Feedback is a polite live status region.

“Show hint” reveals the three authored hints in order and disables after the third. Incorrect choices also advance that ladder. “Show answer” highlights every accepted choice and shows their labels with the success explanation. “Try again” redraws the current round, clearing its hint progress, answer styling, and feedback. Changing questions resets that question preview; no learner score or completion record is stored.

### Buttons and read-aloud

Standard buttons use semibold text, 11px by 16px padding, and a minimum height of 44px. Primary actions use Action Green; ordinary actions use Secondary; quiet actions use a transparent background with Link Teal. Hover changes the fill, while keyboard focus uses a three-pixel Focus Blue outline offset by four pixels. Disabled controls use 0.45 opacity.

“Read question aloud” uses browser speech synthesis, reading the prompt and each choice’s `spokenLabel` or visible label in US English at a rate of 0.86. Written feedback explains unsupported or failed speech. Changing the lesson, question, or overview cancels active speech. There is no produced narration, reviewed voice track, or paid voice service in this packet.

### Teaching and review material

The round notes show its purpose, the complete hint ladder, and a disclosure titled “How the visual would explain it.” That disclosure documents proposed demonstration behavior; the preview scenes stay static. For example, the [trains lesson](lessons/trains/lesson.json) describes future ghost-piece placement and route tracing, while the [colors lesson](lessons/colors/lesson.json) describes a required paint-stirring demonstration for later child delivery. Those animations are not implemented here.

The teaching plan contains Pip’s introduction, beginner support, optional extension, misconception, story ending, offline activity, design notes, and linked references. The review section presents three lesson-specific questions followed by a decision select and resizable notes field. Labels remain visible above the controls; the textarea is at least 125px tall.

Decision changes and note input save immediately under the date-scoped browser storage key `wwm-lesson-review-2026-09-30`. A status message explains whether local storage succeeded. “Download review notes” exports a JSON file with every available lesson’s ID, title, decision, and notes; it does not send feedback or update source files. Storage availability and voice availability depend on the browser. The lesson README and SVG files remain readable if JavaScript is unavailable.

## Do's and Don'ts

- Preserve the education app’s visual lineage and Pip’s recognizable appearance.
- Give the exact scene, prompt, answer choices, and explanation priority over atmospheric illustration.
- Keep teaching rationale, simplifications, proposed visual demonstrations, and references inspectable by an adult.
- Preserve alternate acceptable answers and free navigation; keep round five optional.
- Keep review decisions local and make download behavior clear.
- Do not present generated illustration details as an authoritative letter, quantity, route, or scientific diagram.
- Do not claim that written visual-hint plans, finales, or demonstration scripts are already animated.
- Do not couple this artifact to game routes, physics, learning contracts, learner accounts, provider services, or production deployment.
- Do not infer educator validation, child playtesting, learning effectiveness, or final browser/device checks from a complete asset inventory or a successful gallery build.
