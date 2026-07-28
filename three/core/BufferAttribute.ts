/* BufferAttribute: one vertex stream (positions, normals, uvs, indices).
 *
 * three ships CONCRETE subclasses (Float32BufferAttribute,
 * Uint16BufferAttribute), which is convenient here: the dialect has no
 * generic classes, and three's own naming sidesteps that entirely.
 *
 * The data lives as a plain number[] and is serialised to a Buffer on
 * upload, because the FFI's `bytes` class is what crosses to GL.
 */
export class BufferAttribute {
  array: number[];
  itemSize: number;
  normalized: boolean;
  /** Set once the renderer has uploaded this to a GL buffer. */
  needsUpdate = true;

  constructor(array: number[], itemSize: number, normalized: boolean = false) {
    this.array = array;
    this.itemSize = itemSize;
    this.normalized = normalized;
  }

  get count(): number { return (this.array.length / this.itemSize) | 0; }

  getX(i: number): number { return this.array[i * this.itemSize]; }
  getY(i: number): number { return this.array[i * this.itemSize + 1]; }
  getZ(i: number): number { return this.array[i * this.itemSize + 2]; }

  setXYZ(i: number, x: number, y: number, z: number): BufferAttribute {
    const o = i * this.itemSize;
    this.array[o] = x;
    this.array[o + 1] = y;
    this.array[o + 2] = z;
    return this;
  }

  /** float32 bytes, for a vertex buffer upload. */
  toFloat32Buffer(): Buffer {
    const out = Buffer.alloc(this.array.length * 4);
    for (let i = 0; i < this.array.length; i++) {
      out.writeFloatLE(this.array[i], i * 4);
    }
    return out;
  }

  /** uint16 bytes, for an index buffer upload. */
  toUint16Buffer(): Buffer {
    const out = Buffer.alloc(this.array.length * 2);
    for (let i = 0; i < this.array.length; i++) {
      out.writeUInt16LE(this.array[i], i * 2);
    }
    return out;
  }
}

/** three's name for a float attribute. */
export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: number[], itemSize: number, normalized: boolean = false) {
    super(array, itemSize, normalized);
  }
}

/** three's name for a 16-bit index attribute. */
export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array: number[], itemSize: number, normalized: boolean = false) {
    super(array, itemSize, normalized);
  }
}
