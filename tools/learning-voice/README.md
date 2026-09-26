# @wwm/learning-voice

Build-time voice for learning documents. Pip, the guide in `@wwm/learning`, speaks every line of the baseline
path from pre-generated ElevenLabs clips with word timings. The timings let the lesson page and the game light
each gem as it is counted.

```sh
pnpm learning:voice              # dry run: lines whose clip is missing or stale, and the characters a write would spend
pnpm learning:voice --write      # generate them, upload to R2, rewrite packages/learning/src/voice-manifest.json
pnpm learning:voice --verify     # check every manifest clip exists in R2
pnpm learning:voice --audition   # voice 4 sample lines with each candidate voice → audition.html (gitignored)
```

## How it works
- `pathScript(baselinePath)` in `@wwm/learning` is the single list of lines. Counting and match lines are generated from the round data, so they never disagree with the picture.
- Each clip is named `sha256(text, voiceId, model, settingsHash)`, truncated to 32 hex characters. A changed line, or a changed voice in `voice.config.json`, regenerates only what changed.
- The CLI starts `proxy/`, a local helper Worker that is never deployed, under `wrangler dev`:
  - Its AI binding calls **AI Gateway `wwm`** with provider `elevenlabs` and the `v1/text-to-speech/<voice>/with-timestamps` endpoint. The ElevenLabs key is stored in the gateway (BYOK), and the gateway is authenticated. The binding uses your `wrangler login`, so no key or gateway token is kept on disk.
  - Its remote R2 binding writes `<hash>.mp3` to the bucket **`wwm-learning-audio`**, which is public read-only at `https://learning-audio.ewj.dev/`. Files are immutable and cached for a year, with CORS for GET/HEAD.
- The manifest keeps hashes and word start times, but no audio. `@wwm/learning` tests fail if any baseline line lacks a matching clip.

## Requirements
- `wrangler login` to the Cloudflare account that owns the gateway and bucket.
- Consumers pick the audio origin themselves (`DEFAULT_AUDIO_BASE`). A document never supplies a URL.
- If a clip is missing or blocked, the player falls back to browser speech, and then to silent timing.

## Voice
Pip's voice is set in `voice.config.json`:
- Default: `eleven_v3`, using ElevenLabs premade voice "Jessica".
- Candidates for the audition are listed under `audition`.
- To switch, change `voiceId` and run `--write`. About 4,000 characters regenerate for the whole path.
