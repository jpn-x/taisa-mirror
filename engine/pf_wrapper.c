/* TAISA Mirror: thin WASM wrapper around UxPlay's playfair (GPL-3.0).
 * Static buffers only, so the host needs no malloc. */
#include "playfair/playfair.h"

static unsigned char m3[164];
static unsigned char ct[72];
static unsigned char out[16];

unsigned char *pf_m3(void)  { return m3; }
unsigned char *pf_ct(void)  { return ct; }
unsigned char *pf_out(void) { return out; }
void pf_decrypt(void)       { playfair_decrypt(m3, ct, out); }
