/* Skia enum values, transcribed from the pinned Skia headers. HOST ABI.
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
