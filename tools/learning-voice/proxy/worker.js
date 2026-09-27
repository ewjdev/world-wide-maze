// See wrangler.jsonc. POST /tts { text, voiceId, model, settings, seed, key } → ElevenLabs with-timestamps through
// AI Gateway `wwm`; the MP3 is written to R2 as `<key>` and the character alignment is returned.
// HEAD /object/<key> → 200 when the object exists.
const KEY = /^(?:audition\/)?[a-z0-9-]{1,64}\.mp3$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/object/')) {
      const key = decodeURIComponent(url.pathname.slice('/object/'.length));
      if (!KEY.test(key)) return new Response('bad key', { status: 400 });
      const head = await env.AUDIO.head(key);
      return new Response(null, { status: head ? 200 : 404 });
    }
    if (url.pathname !== '/tts' || request.method !== 'POST')
      return new Response('not found', { status: 404 });
    const { text, voiceId, model, settings, seed, key } = await request.json();
    if (!KEY.test(key) || !/^[A-Za-z0-9]{8,40}$/.test(voiceId))
      return new Response('bad request', { status: 400 });
    const response = await env.AI.gateway('wwm').run({
      provider: 'elevenlabs',
      endpoint: `v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
      headers: { 'content-type': 'application/json' },
      query: { text, model_id: model, voice_settings: settings, seed },
    });
    if (!response.ok) return new Response(await response.text(), { status: response.status });
    const body = await response.json();
    const bytes = Uint8Array.from(atob(body.audio_base64), (c) => c.charCodeAt(0));
    await env.AUDIO.put(key, bytes, {
      httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000, immutable' },
    });
    return Response.json({ alignment: body.alignment, bytes: bytes.length });
  },
};
