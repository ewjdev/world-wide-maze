/** Preservation mode uses bundled stages and local scores, with no API/relay traffic. */
let resting = typeof location !== 'undefined' && new URLSearchParams(location.search).has('offline');
export const servicesResting = () => resting;
export const serviceFetch: typeof fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const dynamic = /\/api\//.test(raw);
  if (resting && dynamic)
    return Response.json(
      { code: 'RATE_LIMITED', message: 'Online services are resting. Play the practice maze.' },
      { status: 429 },
    );
  const response = await fetch(input, init);
  if (response.headers.get('x-wwm-mode') === 'static') {
    resting = true;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('wwm-services-resting'));
  }
  return response;
};
