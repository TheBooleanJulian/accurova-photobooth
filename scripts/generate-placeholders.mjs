// Generates stand-in background artwork for templates that are still waiting
// for licensed photographs. Run with `npm run placeholders`.
// Replace the outputs with real photos (see docs/TEMPLATE_DEVELOPMENT.md);
// re-running this script overwrites only the *-placeholder.svg files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const sets = {
  'little-red-dot-tours': [
    ['marina-bay-sands', 'Marina Bay Sands', ['#f4d9b0', '#e9a37a', '#7c4a5a'], 0.6],
    ['gardens-by-the-bay', 'Gardens by the Bay', ['#dfe8c8', '#9cc0a0', '#3f6a5f'], 0.62],
    ['merlion-marina-bay', 'Merlion / Marina Bay', ['#dcebf2', '#9cc4d8', '#4b6f8c'], 0.58],
    ['peranakan-shophouses', 'Peranakan shophouse street', ['#f6e3d3', '#e8b7a8', '#a85c5c'], 0.66],
    ['chinatown-heritage', 'Chinatown heritage street', ['#f5dcc0', '#dd9a6c', '#8e3b2f'], 0.66],
    ['heritage-architecture', 'Singapore heritage architecture', ['#ece6da', '#c9bfae', '#6f6558'], 0.64],
  ],
};

const W = 1080;
const H = 1920;

function background(label, [sky, mid, ground], horizon) {
  const hy = Math.round(H * horizon);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky}"/>
      <stop offset="1" stop-color="${mid}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${hy}" fill="url(#sky)"/>
  <rect y="${hy}" width="${W}" height="${H - hy}" fill="${ground}"/>
  <rect y="${hy}" width="${W}" height="6" fill="#ffffff" opacity="0.35"/>
  <g fill="#ffffff" opacity="0.9" font-family="Helvetica, Arial, sans-serif" text-anchor="middle">
    <text x="${W / 2}" y="330" font-size="34" letter-spacing="10">PLACEHOLDER BACKGROUND</text>
    <text x="${W / 2}" y="410" font-size="58" font-weight="700">${label.replace(/&/g, '&amp;')}</text>
    <text x="${W / 2}" y="470" font-size="28" opacity="0.85">Replace with a licensed photograph</text>
  </g>
</svg>
`;
}

for (const [template, items] of Object.entries(sets)) {
  const dir = join(root, 'templates', template, 'backgrounds');
  mkdirSync(dir, { recursive: true });
  for (const [id, label, colours, horizon] of items) {
    writeFileSync(join(dir, `${id}-placeholder.svg`), background(label, colours, horizon));
  }
  console.log(`${template}: ${items.length} placeholder backgrounds written`);
}
