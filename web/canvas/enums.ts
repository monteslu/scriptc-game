/* globalCompositeOperation: the CSS name -> SkBlendMode mapping.
 *
 * This is a WEB SPEC table (the canvas spec's 26 composite operations), which
 * is why it lives under web/ while the raw Skia enum ints live in
 * host/skia-enums.ts. The values it maps TO are ABI; the names it maps FROM
 * are the standard.
 */

/** Maps a CSS globalCompositeOperation name to an SkBlendMode value.
 *
 * The canvas spec's names and Skia's enum agree on semantics but not on
 * spelling; the six Porter-Duff "-over"/"-in"/"-out"/"-atop" pairs plus the
 * separable and non-separable blend modes are all present. An unknown name
 * returns source-over, which is what a browser does with an invalid value.
 */
const BLEND = new Map<string, number>([
  ["clear", 0],
  ["copy", 1],
  ["destination", 2],
  ["source-over", 3],
  ["destination-over", 4],
  ["source-in", 5],
  ["destination-in", 6],
  ["source-out", 7],
  ["destination-out", 8],
  ["source-atop", 9],
  ["destination-atop", 10],
  ["xor", 11],
  ["lighter", 12],
  ["plus-lighter", 12],
  ["modulate", 13],
  ["screen", 14],
  ["overlay", 15],
  ["darken", 16],
  ["lighten", 17],
  ["color-dodge", 18],
  ["color-burn", 19],
  ["hard-light", 20],
  ["soft-light", 21],
  ["difference", 22],
  ["exclusion", 23],
  ["multiply", 24],
  ["hue", 25],
  ["saturation", 26],
  ["color", 27],
  ["luminosity", 28],
]);

export const BLEND_SRC_OVER = 3;

export function blendMode(name: string): number {
  const v = BLEND.get(name);
  return v === undefined ? BLEND_SRC_OVER : v;
}
