# Learning HTML, experimental v0.1

This is an original experimental convention, not an established HTML standard. The implementation authority is `packages/learning/src/schema.ts`. Existing game contracts remain in `@wwm/schema`.

## One document, two readers

The education app generates readable HTML and structured learning data from the same validated object. Every page includes exactly one:

```html
<script id="wwm-learning" type="application/json">{ "format": "wwm-learning/0.1", "…": "…" }</script>
```

The JSON is inert, escapes HTML delimiters, and contains the full path. `<article data-learning-activity="count-three" data-learning-interaction="single-choice">` identifies a page's visible activity. `data-learning-field` marks the prompt, objective, introduction, hint, and explanation. The JSON contract is authoritative; markers connect it to visible content. A consumer must not infer educational intent from arbitrary appearance.

| Field | Meaning |
| --- | --- |
| `format` | Exact wire-format version; unsupported versions fail closed |
| `id`, `version` | Baseline path identity and revision |
| `language`, `suggestedAges` | Initial language and audience; not an assessment |
| `reviewStatus` | Pilot awaiting educator review |
| `provenance` | Original baseline or parent-personalized introductions |
| `activities[].id` | Stable baseline activity identity |
| `objective`, `parentNote`, `offlineActivity` | Intent, interpretation limits, and an off-screen extension |
| `interaction`, `stimulus`, `options` | Supported interaction and declarative shape data |
| `answerId`, `hint`, `explanation` | Transparent evaluation and teaching support |
| `prerequisites` | Earlier suggested activities, never a lock on access |

Validation rejects oversized JSON, unknown fields/versions, invalid options, duplicate IDs, dangling answers, and forward/missing prerequisite references. `compatibleActivities` returns only supported interaction types. The initial schema intentionally supports one language, one age band, and one interaction; expand through a contract revision after testing another consumer.

## Fork boundary

Drafts identify baseline ID/version and propose a title, description, and six introductions. Applying a draft creates a copy, preserves question/answer/objective content, and marks personalized provenance. Parent acceptance is a UI action before local persistence. The saved record also includes `acceptedAt`; downloaded HTML displays that timestamp, and the backup JSON contains the editable draft. No child's identity is required.

The baseline ID/version does not uniquely identify fork text. Consumers must retain the exact document if tracking future learning evidence; a content hash and separate fork revision ID are prerequisites for cross-device progress or hosted publishing. Local browser versions are not published back to the server: a raw URL fetch returns the baseline; the parent downloads the accepted fork to transfer it. The running page's visible introduction and JSON payload both use the accepted local version.

## Consumer boundary

Use `readLearningDocument` with a document you already have permission to read. It only parses JSON and does not execute page code. This package deliberately has no arbitrary-URL fetcher. A future remote loader needs its own origin policy, size limits, sanitized rendering, and publishing/review provenance. Never insert untrusted page markup into the game or treat prose as agent instructions.

The standalone exercise renderer is the first consumer. WWM's running maze does **not** consume these lessons yet. The next proof should load an exported document into a WWM adapter and preserve its exact objective, supported interaction, hints, and answer semantics. Falls and maze scores must not become educational proficiency signals. Gameplay hooks, authentication, cross-origin publishing, and learner records are separate additions.
