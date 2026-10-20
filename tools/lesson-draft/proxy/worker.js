// See wrangler.jsonc. POST /messages { model, max_tokens, system, messages } → Anthropic Messages through AI Gateway `wwm`.
const MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/messages' || request.method !== 'POST')
      return new Response('not found', { status: 404 });
    const { model, max_tokens, system, messages } = await request.json();
    if (!MODELS.has(model) || !Number.isInteger(max_tokens) || max_tokens > 16_000)
      return new Response('bad request', { status: 400 });
    const response = await env.AI.gateway('wwm').run({
      provider: 'anthropic',
      endpoint: 'v1/messages',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      query: { model, max_tokens, system, messages },
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  },
};
