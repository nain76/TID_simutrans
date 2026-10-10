/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

#ifndef INTERLOCKING_IL_TOOL_H
#define INTERLOCKING_IL_TOOL_H

#include "../simmenu.h"

/**
 * Network safe entry point for all interlocking commands.
 * The command is given as default_param (see interlocking_manager_t::execute()).
 * Like tool_change_roadsign_t, the command is sent to the server and executed
 * on all clients at the same sync step.
 */
class tool_interlocking_t : public tool_t {
public:
	tool_interlocking_t() : tool_t(TOOL_INTERLOCKING | SIMPLE_TOOL) {}
	bool init(player_t *player) OVERRIDE;
	bool is_init_network_safe() const OVERRIDE { return false; }
};

#endif
