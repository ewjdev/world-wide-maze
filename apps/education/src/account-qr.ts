/**
 * QR code as inline SVG, the same way the game draws its pairing QR (apps/web/src/controller/QrCode.tsx):
 * `uqr` encodes, one path draws the modules, built with DOM calls (no innerHTML).
 */
import { encode } from 'uqr';

const SVG = 'http://www.w3.org/2000/svg';

export function qrSvg(text: string, size: number, label: string): SVGSVGElement {
  const qr = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  qr.data.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${qr.size} ${qr.size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.dataset.text = text;
  const background = document.createElementNS(SVG, 'rect');
  background.setAttribute('width', String(qr.size));
  background.setAttribute('height', String(qr.size));
  background.setAttribute('fill', '#fff');
  const modules = document.createElementNS(SVG, 'path');
  modules.setAttribute('d', d);
  modules.setAttribute('fill', '#000');
  svg.append(background, modules);
  return svg;
}
