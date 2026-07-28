/* Can a base class hold typed arrays that subclasses register into?
 * That is the scene-graph downcast problem without any downcast. */
class Node3D {
  children: Node3D[] = [];
  visible = true;
  add(c: Node3D): void { this.children.push(c); }
}

class Mesh3D extends Node3D { tag = "mesh"; }
class Light3D extends Node3D { tag = "light"; }

/* The SCENE keeps the concrete lists; a mesh registers on add. */
class Scene3D extends Node3D {
  meshes: Mesh3D[] = [];
  lights: Light3D[] = [];
  addMesh(m: Mesh3D): void { this.add(m); this.meshes.push(m); }
  addLight(l: Light3D): void { this.add(l); this.lights.push(l); }
}

const s = new Scene3D();
s.addMesh(new Mesh3D());
s.addMesh(new Mesh3D());
s.addLight(new Light3D());
console.log(`meshes=${s.meshes.length} lights=${s.lights.length} children=${s.children.length}`);
for (let i = 0; i < s.meshes.length; i++) console.log(`  ${s.meshes[i].tag}`);
console.log("typed registry works");
