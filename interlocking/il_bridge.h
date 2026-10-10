/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

#ifndef INTERLOCKING_IL_BRIDGE_H
#define INTERLOCKING_IL_BRIDGE_H

/**
 * Local TCP server for the external interlocking panel.
 *
 * Listens only on 127.0.0.1. The port is read from "interlocking.tab" in the
 * user directory ("port=13360"), or from the environment variable TID_IL_PORT.
 * Without either the bridge stays disabled.
 *
 * Protocol: one line per message (UTF-8), see interlocking/PROTOCOL.md.
 * The bridge never changes the game state directly: commands are passed to
 * tool_interlocking_t, which is executed network safe.
 */
namespace il_bridge {
	void poll();
	void shutdown();
}

#endif
