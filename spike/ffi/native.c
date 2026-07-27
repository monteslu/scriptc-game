#include <stdint.h>
#include <string.h>
#include <stdio.h>

double sg_f64(double v) { return v * 2.0; }
uint8_t sg_bool(uint8_t v) { return v ? 0 : 1; }
uint8_t sg_u8(uint8_t v) { return (uint8_t)(v + 1); }
uint32_t sg_u32(uint32_t v) { return v * 3u; }
int32_t sg_i32(int32_t v) { return -v; }
void sg_void(double v) { (void)v; }

/* string IN: sum bytes */
uint32_t sg_str_sum(const uint8_t* p, size_t n) {
  uint32_t s = 0; for (size_t i = 0; i < n; i++) s += p[i]; return s;
}
/* bytes IN: sum bytes; also reinterpret as floats to prove f32 view crossing */
uint32_t sg_bytes_sum(const uint8_t* p, size_t n) {
  uint32_t s = 0; for (size_t i = 0; i < n; i++) s += p[i]; return s;
}
double sg_bytes_as_f32(const uint8_t* p, size_t n, uint32_t idx) {
  if ((idx + 1) * 4 > n) return -1.0;
  float f; memcpy(&f, p + idx * 4, 4); return (double)f;
}
