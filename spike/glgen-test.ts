/* Does the GENERATED binding layer build and link, all 118 of it?
 * Uses a handful; the manifest declares every one, so a bad signature
 * anywhere fails the build. */
declare function glClear(a0: number): void;
declare function glGetError(): number;
declare function sg_gl_clear_color(a0: number, a1: number, a2: number, a3: number): void;
declare function glViewport(a0: number, a1: number, a2: number, a3: number): void;

sg_gl_clear_color(0.25, 0.5, 0.75, 1.0);
glViewport(0, 0, 320, 240);
glClear(0x00004000);
console.log(`glGetError -> ${glGetError()}`);
console.log("generated GL bindings link");
