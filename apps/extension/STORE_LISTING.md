# Chrome Web Store listing: DRAFT (not submitted)

> Draft for the project owner. Nothing here has been submitted. Publishing needs the owner's developer account,
> a production build (`pnpm --filter @wwm/extension build --origin https://<game domain>`), the final domain
> in the privacy text, and screenshots at 1280×800 (see `docs/build-log/assets/phase-14/`).

## Name
World Wide Maze: Maze this page

## Summary (≤ 132 characters)
Turn the page you're on into a 3D marble maze. Built in your browser; nothing is uploaded unless you share.

## Category
Entertainment (alternative: Fun)

## Description
World Wide Maze turns websites into floating 3D island mazes that you roll a ball through, steered with
your phone or the keyboard. It's a tribute to the 2013 Chrome Experiment by Google Japan and PARTY.

This extension adds one button: **Maze this page**.

- Works on the page you're looking at, as you see it, including pages behind a login.
- One click: the extension photographs the whole page, reads its layout, and opens the game with your maze.
- Private by design: the capture and the maze are made in your browser. Nothing leaves your computer
  unless you press **Share** in the game, which uploads that one capture to make an unlisted link.
- Minimal access: it reads a tab only when you click the button, and it talks only to the game's own address.

How to play: tilt your phone (pair it with the code on screen) or use the arrow keys. Hold POWER to tilt, JUMP
over gaps, collect items, and reach the goal before the time runs out.

World Wide Maze is a fan tribute. It isn't affiliated with or endorsed by Google or PARTY.

## Single purpose (for review)
Capture the current tab when the user clicks the toolbar button, and open it as a playable maze in the World
Wide Maze game.

## Permission justifications (for review)
- **activeTab**: to read and screenshot the tab the user clicked the button on, only at that moment.
- **scripting**: to run the page-layout reader in that tab, and to hand the capture to the game tab.
- **Host permission (the game's address only)**: to deliver the capture to the game page the extension opens.
  No other sites.
- **Optional host permissions**: requested only if the user changes the game address in settings.

## Data use disclosures (draft answers)
- Does the extension collect user data? **No.** The page capture stays in the browser. It's passed to the game
  tab on the user's own computer.
- If the user presses **Share** in the game (the web page, not the extension), the game uploads that capture
  (screenshot and page layout) to the World Wide Maze server to create an unlisted link. That upload is covered
  by the game's privacy policy: `<game domain>/privacy` (to be published; see `docs/launch/`).
- Not sold, not used for advertising, not used for creditworthiness or lending.

## Privacy policy URL
`https://<game domain>/privacy` (placeholder until the domain is chosen)

## Assets checklist
- [ ] 128×128 icon (the build generates `icons/128.png`)
- [ ] 1–5 screenshots, 1280×800: popup mid-capture, the maze of a page, sketch mode, sharing
- [ ] Small promo tile 440×280 (optional)
- [ ] Production build zip (`dist/wwm-maze-this-page-<version>.zip`) built with the production `--origin`
