/* CSS color parsing, pure TS (no FFI).
 *
 * Dialect notes: no regex captures into arrays of unknown length, no
 * dynamic property lookup for the named-color table (a Map keyed by string
 * is allowed; object-with-computed-key reads are not).
 */

export class Rgba {
  r = 0; g = 0; b = 0; a = 255;
  constructor(r: number, g: number, b: number, a: number) {
    this.r = r; this.g = g; this.b = b; this.a = a;
  }
}

const NAMED = new Map<string, number>([
  ["black", 0x000000], ["white", 0xffffff], ["red", 0xff0000],
  ["green", 0x008000], ["lime", 0x00ff00], ["blue", 0x0000ff],
  ["yellow", 0xffff00], ["cyan", 0x00ffff], ["aqua", 0x00ffff],
  ["magenta", 0xff00ff], ["fuchsia", 0xff00ff], ["gray", 0x808080],
  ["grey", 0x808080], ["silver", 0xc0c0c0], ["maroon", 0x800000],
  ["olive", 0x808000], ["navy", 0x000080], ["purple", 0x800080],
  ["teal", 0x008080], ["orange", 0xffa500], ["pink", 0xffc0cb],
  ["brown", 0xa52a2a], ["gold", 0xffd700], ["transparent", -1],
]);

function hexDigit(c: string): number {
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "a" && c <= "f") return c.charCodeAt(0) - 87;
  if (c >= "A" && c <= "F") return c.charCodeAt(0) - 55;
  return -1;
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), and the common names.
 * An unparseable color is opaque black, matching the browser's "invalid
 * value is ignored" outcome closely enough for game code. */
export function parseColor(css: string): Rgba {
  const s = css.trim().toLowerCase();

  if (s.length > 0 && s.charAt(0) === "#") {
    const hex = s.substring(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = hexDigit(hex.charAt(0));
      const g = hexDigit(hex.charAt(1));
      const b = hexDigit(hex.charAt(2));
      let a = 15;
      if (hex.length === 4) a = hexDigit(hex.charAt(3));
      if (r >= 0 && g >= 0 && b >= 0 && a >= 0) {
        return new Rgba(r * 17, g * 17, b * 17, a * 17);
      }
    } else if (hex.length === 6 || hex.length === 8) {
      const r1 = hexDigit(hex.charAt(0)); const r2 = hexDigit(hex.charAt(1));
      const g1 = hexDigit(hex.charAt(2)); const g2 = hexDigit(hex.charAt(3));
      const b1 = hexDigit(hex.charAt(4)); const b2 = hexDigit(hex.charAt(5));
      let a = 255;
      if (hex.length === 8) {
        const a1 = hexDigit(hex.charAt(6)); const a2 = hexDigit(hex.charAt(7));
        if (a1 >= 0 && a2 >= 0) a = a1 * 16 + a2;
      }
      if (r1 >= 0 && r2 >= 0 && g1 >= 0 && g2 >= 0 && b1 >= 0 && b2 >= 0) {
        return new Rgba(r1 * 16 + r2, g1 * 16 + g2, b1 * 16 + b2, a);
      }
    }
    return new Rgba(0, 0, 0, 255);
  }

  if (s.startsWith("rgb")) {
    const open = s.indexOf("(");
    const close = s.indexOf(")");
    if (open >= 0 && close > open) {
      const parts = s.substring(open + 1, close).split(",");
      if (parts.length >= 3) {
        const r = clamp255(parseFloat(parts[0]));
        const g = clamp255(parseFloat(parts[1]));
        const b = clamp255(parseFloat(parts[2]));
        let a = 255;
        if (parts.length >= 4) {
          const af = parseFloat(parts[3]);
          a = clamp255(af <= 1 ? af * 255 : af);
        }
        return new Rgba(r, g, b, a);
      }
    }
    return new Rgba(0, 0, 0, 255);
  }

  const named = NAMED.get(s);
  if (named !== undefined) {
    if (named < 0) return new Rgba(0, 0, 0, 0); // transparent
    return new Rgba((named >> 16) & 255, (named >> 8) & 255, named & 255, 255);
  }

  return new Rgba(0, 0, 0, 255);
}

function clamp255(v: number): number {
  if (!(v > 0)) return 0; // also catches NaN
  if (v > 255) return 255;
  return v | 0;
}
