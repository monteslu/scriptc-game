/* TextMetrics: the measureText() result.
 *
 * A record, not a class with a live backing object: the values are latched at
 * measure time. Only the fields Skia's line metrics can actually supply are
 * present; the rest of the web's TextMetrics (emHeight*, alphabetic/hanging
 * baselines) would be invented numbers.
 */
export class TextMetrics {
  width = 0;
  actualBoundingBoxAscent = 0;
  actualBoundingBoxDescent = 0;
  fontBoundingBoxAscent = 0;
  fontBoundingBoxDescent = 0;
}
