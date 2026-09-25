/**
 * Evidence screenshots, except the internal-only BBC fixture's (licensing, see fixtures/captures/README.md): the
 * `[!b]` pattern keeps `bbc-*` files out of the build entirely. Name evidence files so they don't start with `b`.
 */
export const ASSETS = import.meta.glob<string>(
  '../../../../../docs/build-log/assets/**/[!b]*.{png,jpg,webp}',
  {
    query: '?url',
    import: 'default',
    eager: true,
  },
);
