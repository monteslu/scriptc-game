/* The Context2D style state that save()/restore() must snapshot.
 *
 * Skia's canvas save/restore covers the matrix and the clip; the canvas spec
 * also saves the DRAWING STATE (colors, line params, font, composite op).
 * Keeping that state here as a plain record makes the snapshot a shallow
 * copy rather than a pile of parallel stacks.
 */
import { Rgba } from "./color.js";

export class Style {
  fill = new Rgba(0, 0, 0, 255);
  stroke = new Rgba(0, 0, 0, 255);
  /** Shader handles; 0 means "use the flat colour above". */
  fillShader = 0;
  strokeShader = 0;

  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  miterLimit = 10;
  globalAlpha = 1;
  composite = "source-over";

  dash: number[] = [];
  dashOffset = 0;

  font = "10px sans-serif";
  fontFamily = "sans-serif";
  fontSize = 10;
  fontWeight = 400;
  fontSlant = 0;
  textAlign = "start";
  textBaseline = "alphabetic";

  smoothing = true;
}

/** Shallow copy: every field is a scalar, a string, or an owned array. */
export function cloneStyle(s: Style): Style {
  const c = new Style();
  c.fill = new Rgba(s.fill.r, s.fill.g, s.fill.b, s.fill.a);
  c.stroke = new Rgba(s.stroke.r, s.stroke.g, s.stroke.b, s.stroke.a);
  c.fillShader = s.fillShader;
  c.strokeShader = s.strokeShader;
  c.lineWidth = s.lineWidth;
  c.lineCap = s.lineCap;
  c.lineJoin = s.lineJoin;
  c.miterLimit = s.miterLimit;
  c.globalAlpha = s.globalAlpha;
  c.composite = s.composite;
  const d: number[] = [];
  for (let i = 0; i < s.dash.length; i++) d.push(s.dash[i]);
  c.dash = d;
  c.dashOffset = s.dashOffset;
  c.font = s.font;
  c.fontFamily = s.fontFamily;
  c.fontSize = s.fontSize;
  c.fontWeight = s.fontWeight;
  c.fontSlant = s.fontSlant;
  c.textAlign = s.textAlign;
  c.textBaseline = s.textBaseline;
  c.smoothing = s.smoothing;
  return c;
}
