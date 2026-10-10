/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

#include "il_tool.h"
#include "il_manager.h"


bool tool_interlocking_t::init(player_t *player)
{
	interlocking_manager_t::get()->execute(default_param, player);
	// simple tool: never stays selected
	return false;
}
