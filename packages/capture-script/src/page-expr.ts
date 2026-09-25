/**
 * Turn a self-contained function into a JS expression string for `page.evaluate(expression)`.
 *
 * Why a string: bundlers that preserve function names (tsx, esbuild `keepNames`, which wrangler enables)
 * rewrite nested functions to call a module-level `__name(fn, "name")` helper. That helper doesn't exist
 * inside the page, so `page.evaluate(fn)` would throw `ReferenceError: __name is not defined`.
 * The wrapper declares a no-op `__name` in the evaluated scope.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts any self-contained in-page function
export function pageExpression<A>(fn: (arg: A) => any, arg?: A): string {
  const argJson = arg === undefined ? '' : JSON.stringify(arg);
  return `(() => { const __name = (target) => target; return (${fn.toString()})(${argJson}); })()`;
}
