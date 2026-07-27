#include "sg_tables.h"
#include <stdlib.h>
#include <string.h>

#define SG_INDEX_BITS 24
#define SG_INDEX_MASK ((1u << SG_INDEX_BITS) - 1u)
#define SG_GEN_MASK   0xFFu

static sg_table g_tables[SG_T_COUNT];

/* Slot 0 is reserved so handle 0 can mean "invalid" unambiguously. */
static int ensure_capacity(sg_table* t) {
  if (t->cap == 0) {
    uint32_t cap = 64;
    sg_slot* slots = (sg_slot*)calloc(cap, sizeof(sg_slot));
    if (!slots) return 0;
    t->slots = slots;
    t->cap = cap;
    t->free_head = 0;
    /* thread slots 1..cap-1 onto the free list, lowest first */
    for (uint32_t i = cap - 1; i >= 1; i--) {
      t->slots[i].next = t->free_head;
      t->free_head = i;
    }
    return 1;
  }
  if (t->free_head != 0) return 1;
  if (t->cap > SG_INDEX_MASK / 2) return 0; /* index space exhausted */
  uint32_t ncap = t->cap * 2;
  sg_slot* slots = (sg_slot*)realloc(t->slots, ncap * sizeof(sg_slot));
  if (!slots) return 0;
  memset(slots + t->cap, 0, (ncap - t->cap) * sizeof(sg_slot));
  t->slots = slots;
  for (uint32_t i = ncap - 1; i >= t->cap; i--) {
    t->slots[i].next = t->free_head;
    t->free_head = i;
  }
  t->cap = ncap;
  return 1;
}

uint32_t sg_table_alloc(sg_domain d, void* ptr) {
  if (!ptr || d >= SG_T_COUNT) return 0;
  sg_table* t = &g_tables[d];
  if (!ensure_capacity(t)) return 0;
  uint32_t idx = t->free_head;
  t->free_head = t->slots[idx].next;
  t->slots[idx].ptr = ptr;
  t->slots[idx].next = 0;
  t->live++;
  if (t->live > t->high_water) t->high_water = t->live;
  return ((t->slots[idx].gen & SG_GEN_MASK) << SG_INDEX_BITS) | idx;
}

static sg_slot* slot_of(sg_domain d, uint32_t handle) {
  if (handle == 0 || d >= SG_T_COUNT) return NULL;
  sg_table* t = &g_tables[d];
  uint32_t idx = handle & SG_INDEX_MASK;
  if (idx == 0 || idx >= t->cap) return NULL;
  sg_slot* s = &t->slots[idx];
  if (s->ptr == NULL) return NULL;
  if ((s->gen & SG_GEN_MASK) != ((handle >> SG_INDEX_BITS) & SG_GEN_MASK)) return NULL;
  return s;
}

void* sg_table_get(sg_domain d, uint32_t handle) {
  sg_slot* s = slot_of(d, handle);
  return s ? s->ptr : NULL;
}

void* sg_table_take(sg_domain d, uint32_t handle) {
  sg_slot* s = slot_of(d, handle);
  if (!s) return NULL;
  void* ptr = s->ptr;
  sg_table* t = &g_tables[d];
  s->ptr = NULL;
  s->gen = (s->gen + 1) & SG_GEN_MASK; /* invalidate outstanding handles */
  s->next = t->free_head;
  t->free_head = (uint32_t)(s - t->slots);
  t->live--;
  return ptr;
}

/* Repoints an existing handle at a new object WITHOUT bumping the
 * generation, so handles already held TS-side stay valid. Used when a native
 * object must be replaced wholesale (a paint reset: skiac has no "clear the
 * shader" call, so a pristine SkPaint is swapped in behind the same handle).
 * The caller owns the old pointer that is returned by sg_table_get first. */
int sg_table_replace(sg_domain d, uint32_t handle, void* ptr) {
  sg_slot* s = slot_of(d, handle);
  if (!s || ptr == NULL) return 0;
  s->ptr = ptr;
  return 1;
}

uint32_t sg_table_live(sg_domain d) {
  return d < SG_T_COUNT ? g_tables[d].live : 0;
}

uint32_t sg_table_high_water(sg_domain d) {
  return d < SG_T_COUNT ? g_tables[d].high_water : 0;
}
