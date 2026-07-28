/* Can getContext return a UNION of two context types, as the web does? */
class Ctx2D { kind = "2d"; }
class CtxGL { kind = "webgl2"; }

class Canvas {
  getContext(kind: string): Ctx2D | CtxGL | null {
    if (kind === "2d") return new Ctx2D();
    if (kind === "webgl2") return new CtxGL();
    return null;
  }
}
const c = new Canvas();
const a = c.getContext("2d");
console.log(a === null ? "null" : "got a context");
console.log("union return compiles");
