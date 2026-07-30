# Kenney Space Kit models

Models from the [Kenney Space Kit](https://kenney.nl/assets/space-kit),
released under CC0 1.0 Universal.

The `.obj` + `.mtl` pairs are the SOURCE. `codegen/bake-mesh.js` turns each
into a `.sgm` at build time (see `scripts/bake-models.sh`); the baked files
are gitignored, because a stale one would keep passing against a loader
that no longer matched the baker.

## Why vertex colours and not the colormap texture

Kenney's kit ships a shared `colormap.png` atlas, and threeTS-lite fully
supports textures (`material.map`, uv attributes, `setOffset`/`setRepeat`).
It is NOT used here, for a measured reason: these OBJ exports carry
world-scale UVs, not atlas coordinates.

```
craft_racer.obj    u -39.88..39.88   v -39.88..44.91
hangar_roundA.obj  u -64.39..64.39   v -55.77..55.77
```

Atlas coordinates would sit in 0..1. Sampling a 512x512 colormap with
values in the tens wraps dozens of times per face and produces noise, so
the texture would make the models look worse, not better.

The `.mtl` diffuse colours are the real material data in this kit, and
`bake-mesh.js` converts them to vertex colours: one draw call per model,
with the panel detail (dark cockpit, orange trim, two metals) intact.
