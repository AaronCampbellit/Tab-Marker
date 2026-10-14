import type { IconSpec } from '../shared/types';
import { validateIcon } from './icon';

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

/** SVG stays entirely local and is safe even when the glyph is XML punctuation. */
export function createFavicon(input: IconSpec): string {
  const icon = validateIcon(input);
  const red = Number.parseInt(icon.color.slice(1, 3), 16);
  const green = Number.parseInt(icon.color.slice(3, 5), 16);
  const blue = Number.parseInt(icon.color.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  const foreground = luminance >= 150 ? '#111827' : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="${icon.color}"/><text x="32" y="34" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="${foreground}">${escapeXml(icon.glyph)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
