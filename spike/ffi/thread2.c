#include <pthread.h>
#include <stdint.h>
#include <stdatomic.h>
#include <unistd.h>
static _Atomic uint32_t g_counter = 0;
static pthread_t g_thread;
static _Atomic int g_run = 1;
static void* worker(void* a){(void)a; while(atomic_load(&g_run)){atomic_fetch_add(&g_counter,1); usleep(1000);} return 0;}
int32_t sg_thread_start(int32_t unused) { (void)unused; atomic_store(&g_run,1); return pthread_create(&g_thread,0,worker,0); }
uint32_t sg_thread_count(int32_t unused) { (void)unused; return atomic_load(&g_counter); }
void sg_thread_stop(int32_t unused) { (void)unused; atomic_store(&g_run,0); pthread_join(g_thread,0); }
