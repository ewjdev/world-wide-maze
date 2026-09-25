/**
 * The seven steps of /making. Each pairs what this rebuild's builder does (packages/stage-builder README) with a
 * short quotation from Saqoosha's 2013 case study describing the original step.
 */
import type { LayerToggles } from '@wwm/stage-debugger/draw';

export const CASE_STUDY = 'https://web.dev/case-studies/world-wide-maze';

export interface Step {
  id: string;
  title: string;
  /** What our builder does here. */
  now: string;
  /** Verbatim 2013 quotation (Saqoosha, web.dev case study) and the section it comes from. */
  quote: string;
  quoteSection: string;
  layers: Partial<LayerToggles>;
  /** Needs the builder's intermediate layers (a capture), not just the finished stage. */
  needsDebug: boolean;
  /** Render the engine instead of the 2D plan. */
  threeD?: boolean;
}

const OFF: LayerToggles = {
  screenshot: false,
  dim: false,
  background: false,
  semantic: false,
  land: false,
  lost: false,
  islands: false,
  levels: false,
  contours: false,
  candidates: false,
  bridges: false,
  rails: false,
  restarts: false,
  items: false,
  startGoal: false,
  ids: false,
};

export const STEPS: Step[] = [
  {
    id: 'capture',
    title: 'The page',
    now: 'A headless browser loads the page at 1280 px wide and saves a full-page screenshot plus the position of every visible text block, image, button and link. Pages taller than 1700 px are cut into several stages, played one after another.',
    quote:
      'PhantomJS takes a screenshot, and div and img tag positions are retrieved and output in JSON format.',
    quoteSection: 'Stage builder',
    layers: { ...OFF, screenshot: true },
    needsDebug: false,
  },
  {
    id: 'background',
    title: 'Remove the background',
    now: 'The most common colour becomes sea (blue). Large elements with their own background colour count as local background too, so a coloured banner doesn’t turn into one giant island.',
    quote:
      'we should delete the white background color—in other words the most prevalent color in the screenshot.',
    quoteSection: 'Converting images and text into “islands”',
    layers: { ...OFF, screenshot: true, dim: true, background: true },
    needsDebug: true,
  },
  {
    id: 'islands',
    title: 'Grow islands',
    now: 'Lines of text are thickened and merged into paragraph blocks, images are filled in solid, and each connected block becomes an island. Pieces too small to stand on are dropped (red).',
    quote:
      'The text is too fine and sharp, so we’ll thicken it with cv::dilate, cv::GaussianBlur, and cv::threshold.',
    quoteSection: 'Converting images and text into “islands”',
    layers: { ...OFF, screenshot: true, dim: true, lost: true, islands: true, contours: true },
    needsDebug: true,
  },
  {
    id: 'bridges',
    title: 'Every possible bridge',
    now: 'From each island, straight lines are cast up, down, left and right to the nearest neighbour. Each one that fits a deck 2.5 to 3.6 ball-widths wide without clipping a third island is a candidate (dashed).',
    quote:
      'Each island looks for adjacent islands left, right, above, and below, then connects a bridge to the closest point of the closest island',
    quoteSection: 'Creating bridges to connect the islands',
    layers: { ...OFF, screenshot: true, dim: true, islands: true, contours: true, candidates: true },
    needsDebug: true,
  },
  {
    id: 'maze',
    title: 'Carve the maze',
    now: 'A randomized depth-first walk from the top-left island keeps exactly one route to every island and throws the other bridges away. The seed decides which, so the same page and seed always give the same maze.',
    quote:
      'Keeping all the bridges would make the stage too easy to navigate, so some must be eliminated to create a maze.',
    quoteSection: 'Eliminating unnecessary bridges to create a maze',
    layers: { ...OFF, screenshot: true, dim: true, islands: true, contours: true, bridges: true },
    needsDebug: false,
  },
  {
    id: 'items',
    title: 'Items, rails, start and goal',
    now: 'Start goes top-left and the goal bottom-right, at the points farthest from any edge. Up to six large items take the next-best spots; small items follow rings just inside each edge. Guard rails run along the edges with gaps at every bridge.',
    quote:
      'From all of these possible points, the one at top left is set as the starting point … the one at bottom right is set as the goal … and a maximum of six of the rest are chosen for large item placement',
    quoteSection: 'Placing large items',
    layers: {
      ...OFF,
      screenshot: true,
      dim: true,
      islands: true,
      contours: true,
      bridges: true,
      rails: true,
      items: true,
      startGoal: true,
    },
    needsDebug: false,
  },
  {
    id: '3d',
    title: 'Raise it into 3D',
    now: 'The renderer lifts each island to its own height, textures its top with the page, and adds ramps, lifts, the sea and the ball. Everything of one kind is merged into one mesh, so a stage draws in about 46 calls however complex it is.',
    quote:
      'once I packed the same types of objects all into one mesh, draw calls dropped to fifty or so, improving performance significantly.',
    quoteSection: 'Optimize',
    layers: OFF,
    needsDebug: false,
    threeD: true,
  },
];
