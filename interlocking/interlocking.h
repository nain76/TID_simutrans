/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

#ifndef INTERLOCKING_INTERLOCKING_H
#define INTERLOCKING_INTERLOCKING_H

/*
 * TID interlocking panel (external signal box) - hook entry points.
 *
 * Every call from the OTRP core into this module goes through the functions
 * declared here. In the core files each call site is wrapped in
 * "#ifdef TID_INTERLOCKING" and tagged with "// TID_IL", so that
 *   grep -rn "TID_IL" --include=*.cc --include=*.h .
 * lists all modifications of the core. See interlocking/PORTING.md.
 *
 * Comment out the following line to build a plain OTRP.
 */
#define TID_INTERLOCKING 1

#include "../simtypes.h"

class rail_vehicle_t;
class loadsave_t;

/**
 * H1: called from rail_vehicle_t::is_signal_clear().
 * @return false if the signal is not handled by the interlocking (core continues as usual),
 *         true if handled; then @p result is the value is_signal_clear() must return.
 */
bool interlocking_hook_signal(rail_vehicle_t *v, uint16 next_block, sint32 &restart_speed, bool call_by_step, bool &result);

/**
 * H8: called from rail_vehicle_t::can_enter_tile() when a train wants to start (CAN_START),
 * before it reserves its first block. Same return convention as interlocking_hook_signal().
 * Used for virtual departure signals (platforms without a real departure signal).
 */
bool interlocking_hook_departure(rail_vehicle_t *v, sint32 &restart_speed, bool &result);

/// H2: called once per karte_t::step() (deterministic, runs on every client)
void interlocking_hook_step();

/// H3: called while saving, just before the active player / window data
void interlocking_hook_save(loadsave_t *file);

/// H3: called while loading, at the same position as interlocking_hook_save()
void interlocking_hook_load(loadsave_t *file);

/// H3: called at the very end of loading
void interlocking_hook_load_finished();

/// H4: called at the end of karte_t::rotate90()
void interlocking_hook_rotate90(sint16 y_size);

/// H4: called when the world is destroyed (new map / before loading)
void interlocking_hook_reset();

/// H5: called once per iteration of the main loop (local only, must not change the game state)
void interlocking_hook_interactive();

#endif
