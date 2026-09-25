/**
 * Evidence screenshots. The `[!b]` pattern dates from an internal news-site fixture (`bbc-*`, removed before
 * publication, see NOTICE.md) and still skips files starting with `b` (e.g. Phase 08's `b-*` extra shots).
 */
export const ASSETS = import.meta.glob<string>(
  '../../../../../docs/build-log/assets/**/[!b]*.{png,jpg,webp}',
  {
    query: '?url',
    import: 'default',
    eager: true,
  },
);
