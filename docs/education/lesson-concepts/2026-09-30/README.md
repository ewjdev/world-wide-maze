# Pip’s next adventures — independent review pack

Ten lesson concepts for ages 4–6, extending the guided Gems lesson into rockets, cars, trains, letters, word associations, shapes, colors, animals, plants, and weather.

Open `index.html` in a browser. It works directly from the filesystem and needs no game server, account, network request, or install. Open a lesson to inspect its concept illustration, five question diagrams, exact prompts, answer choices, explanations, three-stage hint ladder, learning rationale, and three review questions.

The **Read question aloud** control uses an available browser voice. The pack does not contain produced or reviewed narration. Review decisions and notes stay in the browser's local storage; **Download review notes** saves a portable JSON copy. The download does not send feedback or write back to this repository.

## Files

- `lessons/<category>/README.md` is the complete human-readable lesson brief.
- `lesson.json` contains the content and answer key.
- `concept.png` is the generated visual direction, with its saved prompt in `image-prompt.txt`.
- `round-1.svg` through `round-5.svg` are precise instructional diagrams. Their geometry and authored answers govern the exercise; concept illustrations introduce the story.
- `index.template.html` and `build.mjs` build the standalone gallery.
- `manifest.json` records the delivered lesson inventory.

Rebuild the review gallery after editing the briefs:

```sh
node docs/education/lesson-concepts/2026-09-30/build.mjs
```

For optional local serving, run the following from this directory:

```sh
python3 -m http.server 5188 --bind 127.0.0.1
```

## Boundary and acceptance

This is a content and visual design review artifact. It is not integrated with the game, lesson runtime, learning contracts, production routes, or paid voice services. No child playtesting, educator validation, production readiness, or learning effectiveness is claimed. The fifth round is an optional stretch, and several lessons deliberately permit more than one suitable answer.

The gallery checks verify asset completeness, content structure, preview interactions, note persistence/export, and responsive rendering. Learning acceptance still requires adult review and a short child playtest using a fresh example.
