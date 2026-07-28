/* Color, linear RGB in 0..1.
 *
 * API-compatible with three: `setHex`, `setRGB`, `r`/`g`/`b` fields, and a
 * constructor taking a hex number.
 *
 * Colour management is deliberately NOT modelled. three has an sRGB/linear
 * pipeline with a global setting; this stores exactly what it is given and
 * uploads it. Game shaders here work in the same space throughout, so the
 * conversion would be a no-op that only adds a way to get it wrong.
 */
export class Color {
  r = 1;
  g = 1;
  b = 1;

  /** `new Color(0xff8800)`, three's most common form. */
  constructor(hex: number = 0xffffff) {
    this.setHex(hex);
  }

  setHex(hex: number): Color {
    const h = Math.floor(hex);
    this.r = ((h >> 16) & 255) / 255;
    this.g = ((h >> 8) & 255) / 255;
    this.b = (h & 255) / 255;
    return this;
  }

  setRGB(r: number, g: number, b: number): Color {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  copy(c: Color): Color { return this.setRGB(c.r, c.g, c.b); }
  clone(): Color { return new Color().setRGB(this.r, this.g, this.b); }

  multiplyScalar(s: number): Color {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }

  lerp(c: Color, alpha: number): Color {
    this.r += (c.r - this.r) * alpha;
    this.g += (c.g - this.g) * alpha;
    this.b += (c.b - this.b) * alpha;
    return this;
  }

  getHex(): number {
    const r = Math.round(this.r * 255);
    const g = Math.round(this.g * 255);
    const b = Math.round(this.b * 255);
    return (r << 16) | (g << 8) | b;
  }

  equals(c: Color): boolean {
    return this.r === c.r && this.g === c.g && this.b === c.b;
  }
}
