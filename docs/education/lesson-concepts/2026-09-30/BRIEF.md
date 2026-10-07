# Ten lesson concepts for review

This folder is an independent design and content review pack for ages 4–6. It does not connect to the game, its runtime, routes, schema, or voice generation services. Existing game files must remain untouched.

## Shared direction

Pip is a friendly small silver-gray ball with dark oval eyes, a smile, and blue curved seams. Preserve the established WWM learning world: daylight, fog-white ground, ink #20262d, blue #317daf, teal #31a4ae, green #318545, yellow #f2c230, red #c74946. Concept illustrations may expand the palette per subject. Use crisp, uncluttered, welcoming illustrations, with distinct silhouettes and objects large enough to see. No text, letters, numbers, labels, UI, or watermark in the generated concept illustration. Exact instructional letters belong in the deterministic question diagrams.

Create one concept illustration through the built-in image_gen tool for each lesson. Read the imagegen skill at /Users/ewj/.codex/skills/.system/imagegen/SKILL.md. Generate one wide landscape illustration and save a copy as concept.png in the assigned lesson folder. Keep the complete prompt in image-prompt.txt. Do not call paid voice APIs or install image tools. If generation fails, report it candidly and preserve the rest of the pack.

Create five 800×440 SVG question diagrams with viewBox="0 0 800 440". These are exact educational diagrams: clear geometry and object silhouettes, no sketch texture, no pseudo-realistic rendering. Each diagram must match its round's spoken question and answer choices. Use minimal embedded text, except when the actual stimulus is a letter. Any small labels must be at least 28px. Add title/desc, avoid answer-revealing arrows or highlighting in the unassisted scene, and give all assets unique ids within the lesson. The diagram is the instructional authority; the generated illustration introduces the story.

## Content contract

Each agent owns exactly its assigned lessons/<id>/ folder. Other agents are working concurrently: do not revert or edit their work, the shared brief, or gallery files. Create:

- lesson.json, following the schema below;
- concept.png and image-prompt.txt;
- round-1.svg through round-5.svg;
- README.md with the complete teaching rationale and questions.

```json
{
  "id": "rockets",
  "number": 1,
  "category": "Rockets",
  "title": "Pip’s Rocket Lab",
  "tagline": "A short concrete invitation",
  "accent": "#317daf",
  "targetMinutes": "2–4",
  "learningGoal": "One clear observable goal",
  "childTakeaway": "A simple sentence the child could say or demonstrate",
  "story": "Why Pip needs the child's help",
  "introPip": "Exact friendly spoken introduction",
  "conceptImage": "concept.png",
  "conceptImageAlt": "Accurate description of the illustration",
  "ageSupport": {"entry": "Support for a beginner", "stretch": "Optional extension for a ready learner"},
  "misconception": "One important misunderstanding to reveal gently",
  "rounds": [
    {
      "id": "r1",
      "title": "Warm-up",
      "prompt": "Exact short spoken question",
      "scene": "round-1.svg",
      "sceneAlt": "Description of the unassisted scene without giving the answer",
      "choices": [{"id": "a", "label": "Choice A", "spokenLabel": "Choice A"}],
      "correctChoiceIds": ["a"],
      "success": "Feedback explaining why, without empty praise",
      "hints": ["Nudge", "Demonstration suggestion", "Worked explanation"],
      "visualHint": "What should visually explain the mechanism in a future implementation",
      "whyThisRound": "What this round reveals"
    }
  ],
  "finale": "The story's satisfying result",
  "offlineActivity": "One brief activity with household objects and a grown-up",
  "reviewQuestions": ["Three specific decisions for Eric to review"],
  "designNotes": ["Honest simplifications, limits, or future visual/interaction needs"],
  "sources": [{"title": "Primary educational/scientific reference", "url": "https://...", "supports": "Precisely what it supports"}]
}
```

There must be exactly five rounds, with two or three choices each. Multiple correctChoiceIds mean any one of those choices is acceptable; do not require hidden multi-select. Keep questions answerable from what is shown or a demonstrated idea. Include an easy start, a closer or changed example, a misconception check, transfer, and an optional stretch as round five. Change answer positions. Hints should explain rather than penalize. Do not require reading, precise dragging, speed, memorizing a script, or identifying an exclusively correct habitat/outfit when alternatives are reasonable. Do not mistake navigating the maze for learning.

Browse primary sources for niche scientific or developmental claims. Cite only sources actually checked; no invented certifications, child-testing results, or claims that these concepts are already implemented. The lesson gallery is an adult review tool, not a validated child experience.

The ten assigned ids are rockets, cars, trains, letters, words, shapes, colors, animals, plants, weather.
