/* Handle tables.
 *
 * scriptc FFI format 1 has no pointer type, so every native object crosses
 * the boundary as a u32 handle and the pointer itself never leaves this
 * side. A handle packs a generation counter with a slot index:
 *
 *     handle = (gen << 24) | index      index 0 is never handed out,
 *                                       so 0 is always "invalid"
 *
 * The generation is bumped on free, so a stale handle is DETECTED (the slot
 * disagrees) rather than silently reused. Our own runtime is the only
 * caller, so this is a bug-catching device, not a security boundary; it
 * exists because the shim must not reintroduce use-after-free into a
 * language that otherwise cannot segfault.
 */
#ifndef SG_TABLES_H
#define SG_TABLES_H

#include <stdint.h>
#include <stddef.h>

/* sg_tables.c is compiled as C11 while sg_core.cpp is C++17, so the
 * declarations below need C linkage or the C++ side emits mangled
 * references that the C definitions never satisfy. */
#ifdef __cplusplus
extern "C" {
#endif

/* Handle domains. Keep in sync with codegen/skia-allowlist.json's `domains`
 * map (the generator emits SG_T_* names straight into the wrappers) and with
 * DOMAIN_NAMES in runtime/canvas/handles.ts. */
typedef enum {
  SG_T_SURFACE = 0,
  SG_T_CANVAS,
  SG_T_PAINT,
  SG_T_PATH,
  SG_T_SHADER,
  SG_T_MATRIX,
  SG_T_IMAGE,
  SG_T_BITMAP,
  SG_T_PATH_EFFECT,
  SG_T_IMAGE_FILTER,
  SG_T_FONT_COLLECTION,
  SG_T_COUNT
} sg_domain;

typedef struct {
  void*    ptr;   /* NULL when free */
  uint32_t gen;   /* low 8 bits used */
  uint32_t next;  /* free-list link */
} sg_slot;

typedef struct {
  sg_slot* slots;
  uint32_t cap;
  uint32_t live;       /* currently allocated */
  uint32_t high_water; /* peak live, for leak tests */
  uint32_t free_head;  /* 0 = none */
} sg_table;

/* Allocates a handle for ptr. Returns 0 if ptr is NULL or on OOM. */
uint32_t sg_table_alloc(sg_domain d, void* ptr);

/* Resolves a handle. Returns NULL for 0, a stale generation, or a bad
 * index : callers turn that into SG_EBADHANDLE plus a mailbox message. */
void* sg_table_get(sg_domain d, uint32_t handle);

/* Resolves AND frees in one step (bumping the generation), so a destroy
 * path cannot double-free. Returns NULL if the handle was already stale. */
void* sg_table_take(sg_domain d, uint32_t handle);

/* Repoints a live handle at a new object, keeping the generation (so
 * outstanding handles stay valid). Returns 0 if the handle is stale. The
 * caller is responsible for destroying the object it replaced. */
int sg_table_replace(sg_domain d, uint32_t handle, void* ptr);

uint32_t sg_table_live(sg_domain d);
uint32_t sg_table_high_water(sg_domain d);

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif
