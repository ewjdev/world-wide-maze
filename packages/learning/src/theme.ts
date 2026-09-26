/**
 * Sky Islands: the default theme. Colours come from the WWM game (engine palette and game.css): the chrome ball
 * with its blue seam, teal item gems, white island tops over blue sides, green bridges, the portal-blue gate.
 * Sprites are drawn in a 0–100 box from declarative parts only; `spriteSvg` (scene.ts) is the trusted renderer.
 */
import type { Theme } from './schema.ts';

export const skyIslands: Theme = {
  id: 'sky-islands',
  name: 'Sky Islands',
  guide: {
    name: 'Pip',
    sprite: 'pip',
    lines: {
      hello: 'Hi, I’m Pip! I roll across the sky islands.',
      bonus: 'Bonus round! Want to try a tricky one?',
      gate: 'A Pip gate! Solve it to open the way.',
      rollOn: 'The gate is open. Let’s roll on!',
    },
  },
  palette: {
    sky: '#f8f8f8',
    cloud: '#edf1f4',
    ink: '#20262d',
    paper: '#ffffff',
    islandTop: '#ffffff',
    islandSide: '#4f9fd6',
    islandEdge: '#9fb3c2',
    bridge: '#3f9a4c',
    gem: '#31a4ae',
    gemEdge: '#206a71',
    gemShine: '#c9f1f4',
    ballShell: '#dfe3e6',
    ballShine: '#ffffff',
    ballSeam: '#456e93',
    gate: '#4f9fd6',
    glow: '#f2c230',
    shapeBlue: '#317daf',
    shapeGreen: '#318545',
    shapeYellow: '#a47b00',
    shapeRed: '#c74946',
  },
  sprites: {
    pip: {
      parts: [
        { type: 'circle', cx: 50, cy: 52, r: 44, fill: 'ballShell', stroke: 'ink', width: 3 },
        { type: 'ellipse', cx: 34, cy: 30, rx: 15, ry: 9, fill: 'ballShine', opacity: 0.95 },
        { type: 'path', d: 'M8 62 C30 50 70 50 92 62', stroke: 'ballSeam', width: 5 },
        { type: 'path', d: 'M50 9 C41 32 41 72 50 96', stroke: 'ballSeam', width: 4, opacity: 0.45 },
        { type: 'ellipse', cx: 38, cy: 48, rx: 5.5, ry: 7.5, fill: 'ink' },
        { type: 'ellipse', cx: 62, cy: 48, rx: 5.5, ry: 7.5, fill: 'ink' },
        { type: 'circle', cx: 39.8, cy: 45, r: 2, fill: 'paper' },
        { type: 'circle', cx: 63.8, cy: 45, r: 2, fill: 'paper' },
        { type: 'path', d: 'M41 68 Q50 76 59 68', stroke: 'ink', width: 3 },
      ],
    },
    gem: {
      parts: [
        {
          type: 'polygon',
          points: [
            [50, 5],
            [89, 27],
            [89, 73],
            [50, 95],
            [11, 73],
            [11, 27],
          ],
          fill: 'gem',
          stroke: 'gemEdge',
          width: 7,
        },
        {
          type: 'polygon',
          points: [
            [50, 9],
            [84, 29],
            [50, 44],
            [16, 29],
          ],
          fill: 'gemShine',
          opacity: 0.75,
        },
      ],
    },
    island: {
      parts: [
        { type: 'rect', x: 0, y: 16, w: 100, h: 84, rx: 12, fill: 'islandSide' },
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: 100,
          h: 80,
          rx: 12,
          fill: 'islandTop',
          stroke: 'islandEdge',
          width: 2,
        },
      ],
    },
    plank: {
      parts: [{ type: 'rect', x: 3, y: 22, w: 94, h: 56, rx: 8, fill: 'bridge', stroke: 'paper', width: 5 }],
    },
    gate: {
      parts: [
        { type: 'circle', cx: 50, cy: 50, r: 42, fill: 'gate', opacity: 0.16 },
        { type: 'circle', cx: 50, cy: 50, r: 42, stroke: 'gate', width: 8 },
        { type: 'circle', cx: 50, cy: 50, r: 25, stroke: 'gate', width: 4, opacity: 0.55 },
      ],
    },
    cloud: {
      parts: [
        { type: 'circle', cx: 34, cy: 58, r: 20, fill: 'cloud' },
        { type: 'circle', cx: 54, cy: 46, r: 27, fill: 'cloud' },
        { type: 'circle', cx: 75, cy: 60, r: 17, fill: 'cloud' },
        { type: 'rect', x: 18, y: 58, w: 72, h: 20, rx: 10, fill: 'cloud' },
      ],
    },
  },
};
