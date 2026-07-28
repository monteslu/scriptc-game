/* Does the ported WebGL2 context COMPILE against the generated bindings? */
import { WebGL2RenderingContext } from "../web/webgl/context.js";
import { COLOR_BUFFER_BIT, ARRAY_BUFFER, STATIC_DRAW, TRIANGLES,
         VERTEX_SHADER, FRAGMENT_SHADER, FLOAT } from "../web/webgl/constants.js";

const gl = new WebGL2RenderingContext(64, 64);
gl.clearColor(0.1, 0.2, 0.3, 1.0);
gl.clear(COLOR_BUFFER_BIT);
const buf = gl.createBuffer();
gl.bindBuffer(ARRAY_BUFFER, buf);
gl.bufferData(ARRAY_BUFFER, Buffer.alloc(48), STATIC_DRAW);
gl.bufferData(ARRAY_BUFFER, 128, STATIC_DRAW);
const vs = gl.createShader(VERTEX_SHADER);
gl.shaderSource(vs, "#version 300 es\nvoid main(){}");
gl.compileShader(vs);
const prog = gl.createProgram();
gl.attachShader(prog, vs);
gl.linkProgram(prog);
gl.useProgram(prog);
const loc = gl.getUniformLocation(prog, "u_thing");
gl.uniform4f(loc, 1, 2, 3, 4);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
gl.drawArrays(TRIANGLES, 0, 3);
console.log(`hash=${gl.hashPixels(0, 0, 64, 64)}`);
console.log("WebGL2 context compiles and runs");
