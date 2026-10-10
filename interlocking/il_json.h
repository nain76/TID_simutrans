/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

#ifndef INTERLOCKING_IL_JSON_H
#define INTERLOCKING_IL_JSON_H

#include "../dataobj/koord3d.h"
#include "../utils/cbuffer_t.h"

/// appends s as a JSON string literal (UTF-8 is passed through)
static inline void append_json_string(cbuffer_t &buf, const char *s)
{
	buf.append("\"");
	for(  const char *c = s ? s : "";  *c;  c++  ) {
		switch(  *c  ) {
			case '"':  buf.append("\\\""); break;
			case '\\': buf.append("\\\\"); break;
			case '\n': buf.append("\\n"); break;
			case '\r': buf.append("\\r"); break;
			case '\t': buf.append("\\t"); break;
			default:
				if(  (unsigned char)*c < 0x20  ) {
					buf.printf("\\u%04x", (unsigned)(unsigned char)*c);
				}
				else {
					char tmp[2] = { *c, 0 };
					buf.append(tmp);
				}
		}
	}
	buf.append("\"");
}

/// appends a position as [x,y,z]
static inline void append_json_pos(cbuffer_t &buf, koord3d pos)
{
	buf.printf("[%d,%d,%d]", pos.x, pos.y, pos.z);
}

#endif
