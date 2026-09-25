# Notice

World Wide Maze Revival is an unofficial tribute to "World Wide Maze", the 2013 Chrome Experiment by Google Japan
and PARTY. It is not affiliated with or endorsed by Google, PARTY or any site listed below. "World Wide Maze",
"Chrome" and "Google" are trademarks of their owners.

## The original 2013 game
None of the original 2013 assets are included: no code bundle, art, audio, localization files or stage data, and
no stage data from the WWMMM repository (Katamari-Inc on GitHub). `pnpm ref:fetch` downloads that reference
material from the Internet Archive and GitHub into `reference/`, which is gitignored, for local study only. The
research notes in `docs/reference/` quote short excerpts for commentary. All game code, visuals and audio here
were written for this project (audio is synthesized in code, see `apps/web/public/audio/CREDITS.md`).

## Third-party web pages in the test fixtures
The stage builder turns a web page into a maze, so its tests and evaluation need real pages. `fixtures/captures/`
holds screenshots and DOM geometry of the pages below, captured once on 2026-09-25 (UTC) for testing and
evaluation. The same pages appear in files derived from them: builder goldens (`fixtures/builder/`), the batch
evaluation report (`fixtures/eval/`), catalog thumbnails (`apps/web/public/thumbs/`), and screenshots in
`docs/build-log/assets/` and `content/build-story/social/`.

Each page remains the property of its owner, under the licence or terms noted. They are included for testing,
not as endorsements, and no licence is granted beyond the one the owner offers. If you own one of these pages and
want it removed, please open an issue.

### Phase 02 fixtures
| Fixture | Page | Source | Licence / terms |
|---|---|---|---|
| `wikipedia-article` | Wikipedia: "Labyrinth" | https://en.wikipedia.org/wiki/Labyrinth | Text CC BY-SA 4.0 (Wikipedia contributors); images individually licensed on Wikimedia Commons |
| `hn-front` | Hacker News front page | https://news.ycombinator.com/ | User-submitted titles; Y Combinator terms apply. Test fixture only |
| `govuk-card-grid` | GOV.UK home page | https://www.gov.uk/ | Open Government Licence v3.0 (Crown copyright) |
| `mdn-dark-docs` | MDN: "Range: getClientRects()" | https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects | CC BY-SA 2.5, Mozilla contributors. The capture includes two third-party ad banners as they appeared on the page |
| `example-sparse` | example.com | https://example.com/ | IANA reserved example domain |
| `image-gallery` | Wikimedia Commons: Picture of the day | https://commons.wikimedia.org/wiki/Commons:Picture_of_the_day | Each image under its own free licence (CC / public domain) on Wikimedia Commons |

### Phase 09 evaluation set (`eval-*`)
Generated from `tools/batch-eval/eval-captures.json`.

| Fixture | Source | Licence / terms (as recorded at capture) |
|---|---|---|
| `eval-aozora-bunko` | https://www.aozora.gr.jp/ | Aozora Bunko: public-domain texts; site chrome by the volunteer project |
| `eval-ja-wikipedia-meiro` | https://ja.wikipedia.org/wiki/%E8%BF%B7%E8%B7%AF | CC BY-SA 4.0 |
| `eval-ja-wikipedia-main` | https://ja.wikipedia.org/wiki/%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8 | CC BY-SA 4.0 |
| `eval-digital-go-jp` | https://www.digital.go.jp/ | Japanese Government Standard Terms of Use (CC BY 4.0 compatible) |
| `eval-mdn-ja-dark` | https://developer.mozilla.org/ja/docs/Web/HTML | CC BY-SA 2.5, Mozilla contributors |
| `eval-github-docs-ja` | https://docs.github.com/ja/get-started/start-your-journey/about-github-and-git | CC BY 4.0 (github/docs) |
| `eval-info-cern-first-site` | https://info.cern.ch/hypertext/WWW/TheProject.html | CERN, public domain release (1993) |
| `eval-sqlite-home` | https://sqlite.org/index.html | SQLite docs are public domain |
| `eval-gutenberg-alice` | https://www.gutenberg.org/ebooks/11 | Project Gutenberg (public-domain work) |
| `eval-python-home` | https://www.python.org/ | PSF site content |
| `eval-python-docs-tutorial` | https://docs.python.org/3/tutorial/index.html | PSF License (docs) |
| `eval-rust-lang` | https://www.rust-lang.org/ | MIT/Apache-2.0 (www.rust-lang.org repo) |
| `eval-go-dev` | https://go.dev/ | CC BY 4.0 (Go website) |
| `eval-react-dev-dark` | https://react.dev/ | CC BY 4.0 (reactjs/react.dev) |
| `eval-nasa-home` | https://www.nasa.gov/ | NASA media: generally public domain (US Gov) |
| `eval-usa-gov` | https://www.usa.gov/ | US Government work, public domain |
| `eval-creativecommons` | https://creativecommons.org/ | CC BY 4.0 |
| `eval-debian` | https://www.debian.org/ | Debian site: DFSG-free (GPL/Expat style) |
| `eval-openstreetmap` | https://www.openstreetmap.org/#map=13/35.6812/139.7671 | ODbL data, CC BY-SA tiles |
| `eval-w3c-home` | https://www.w3.org/ | W3C Document License |
| `eval-wikipedia-main` | https://en.wikipedia.org/wiki/Main_Page | CC BY-SA 4.0 |
| `eval-rust-book-dark` | https://doc.rust-lang.org/book/ch01-00-getting-started.html | MIT/Apache-2.0 |

### Removed before publication
Seven captures used during development were removed before the repository was made public, because we had no
clear right to redistribute their content: a news-site card grid (Phase 02), and six evaluation pages (a
text-only news site, a classifieds site, a CSS-framework marketing page, a Linux kernel portal, a digital library
home page and a Google experiments gallery). Their screenshots, capture data, builder goldens and derived images
were deleted, and their thumbnails are blanked out in the historical dashboard and game screenshots. Build logs
written before the removal still quote figures measured with them.

## Fonts and packages
Web fonts (Figtree, Instrument Sans, Newsreader, Unbounded, IBM Plex Mono) come from `@fontsource` npm packages
under the SIL Open Font License and are not stored in this repository. Other dependencies are installed from npm
under their own licences (see `pnpm-lock.yaml`).

## Licence
The project's own code is released under the [MIT License](LICENSE). Third-party pages in `fixtures/` keep their own licences (see above); no original 2013 World Wide Maze assets are included.
