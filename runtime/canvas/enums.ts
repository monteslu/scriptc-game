/* Skia enum values, transcribed from the pinned Skia headers.
 *
 * These are ABI, not API: the skiac surface takes plain ints, so a wrong
 * value here is a silently wrong picture rather than a compile error. Each
 * block cites the header it came from so a Skia bump can be re-checked
 * mechanically.
 *
 *   SkPaint.h    Style, Cap, Join
 *   SkTileMode.h SkTileMode
 *   SkPathTypes.h SkPathFillType
 *   SkBlendMode.h SkBlendMode
 *   skia_c.hpp   CssBaseline (skiac's own, not Skia's)
 */

// SkPaint::Style
export const STYLE_FILL = 0;
export const STYLE_STROKE = 1;
export const STYLE_STROKE_AND_FILL = 2;

// SkPaint::Cap
export const CAP_BUTT = 0;
export const CAP_ROUND = 1;
export const CAP_SQUARE = 2;

// SkPaint::Join
export const JOIN_MITER = 0;
export const JOIN_ROUND = 1;
export const JOIN_BEVEL = 2;

// SkTileMode
export const TILE_CLAMP = 0;
export const TILE_REPEAT = 1;
export const TILE_MIRROR = 2;
export const TILE_DECAL = 3;

// SkPathFillType
export const FILL_WINDING = 0;
export const FILL_EVEN_ODD = 1;

// CssBaseline (skia_c.hpp)
export const BASELINE_TOP = 0;
export const BASELINE_HANGING = 1;
export const BASELINE_MIDDLE = 2;
export const BASELINE_ALPHABETIC = 3;
export const BASELINE_IDEOGRAPHIC = 4;
export const BASELINE_BOTTOM = 5;

/* Text align, as skparagraph's TextAlign: left, right, center, justify,
 * start, end. Canvas's textAlign maps onto the first five. */
export const ALIGN_LEFT = 0;
export const ALIGN_RIGHT = 1;
export const ALIGN_CENTER = 2;
export const ALIGN_JUSTIFY = 3;
export const ALIGN_START = 4;
export const ALIGN_END = 5;

// SkFontStyle::Slant
export const SLANT_UPRIGHT = 0;
export const SLANT_ITALIC = 1;
export const SLANT_OBLIQUE = 2;

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
