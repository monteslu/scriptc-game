/* Can scriptc's FFI bind raw GLES3 with NO shim?
 * This is the assumption Phase 8 rests on: GL object names are u32 and
 * most entry points are scalars-only, so they should bind straight from
 * the manifest. */
declare function glGetError(): number;
declare function glCreateShader(type: number): number;
declare function glClearColor(r: number, g: number, b: number, a: number): void;
declare function glClear(mask: number): void;
declare function glViewport(x: number, y: number, w: number, h: number): void;

// No GL context here, so calls are expected to be no-ops or errors; what is
// being tested is that they LINK and are CALLABLE.
glClearColor(0.1, 0.2, 0.3, 1.0);
glClear(0x00004000);
glViewport(0, 0, 640, 480);
const err = glGetError();
console.log(`glGetError -> ${err}`);
console.log("GL FFI links and calls");
