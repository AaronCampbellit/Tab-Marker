import type { IconSpec } from '../shared/types';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
const INVISIBLE_FORMATTING = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;

export function validateIcon(value: unknown): IconSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Icon must be an object.');
  const icon = value as Record<string, unknown>;
  if (typeof icon.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(icon.color)) {
    throw new Error('Choose an icon color in #RRGGBB format.');
  }
  if (typeof icon.glyph !== 'string') throw new Error('Choose one visible letter, number, or symbol.');
  const glyph = icon.glyph.trim().normalize('NFC');
  if (!glyph || glyph.length > 32 || CONTROLS.test(icon.glyph) || INVISIBLE_FORMATTING.test(icon.glyph) || /[<>\p{Cs}]/u.test(glyph) || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(glyph)) {
    throw new Error('Choose one visible letter, number, or symbol without markup or control characters.');
  }
  if (Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(glyph)).length !== 1) {
    throw new Error('The icon must contain one letter, number, or symbol.');
  }
  return { color: icon.color.toLowerCase(), glyph };
}
