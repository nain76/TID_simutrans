//
// This file is part of the Simutrans project under the Artistic License.
// (see LICENSE.txt)
//
// Test layout for the TID interlocking panel: routes via a loop (driven by interlocking/tests/via_test.py)
//
//  y=5   D . S1 J . . . . . J . [P  P  P]      D = depot (1,5), S1 = entry signal (3,5), J = junctions (4,5) (10,5)
//  y=6          |           |                  P = platform (12..14,5)
//  y=7          +-----------+                  a loop (4,6)..(10,6) beside the straight track (5..9,5)
//
//  From S1 there are two ways to P: straight along y=5, or round the loop. The loop is plain track
//  between the two junctions: a virtual shunting signal can be put at its east end (10,6).
//

map.file = "empty-16x16.sve"

scenario.short_description = "TID interlocking via test"
scenario.author = "TID"
scenario.version = "0.1"

include("test_helpers")

function get_rule_text(pl)   { return ttext("Interlocking test.") }
function get_goal_text(pl)   { return ttext("-") }
function get_info_text(pl)   { return ttext("-") }
function get_result_text(pl) { return ttext("-") }
function is_tool_allowed(pl, tool_id, wt) { return true }
function is_scenario_completed(pl) { return 0 }

function build_layout()
{
	local pl = player_x(0)
	SET_PLAYER_FUNDS(pl, 100000000)
	local rail = way_desc_x.get_available_ways(wt_rail, st_flat)[0]

	ASSERT_EQUAL(command_x.build_way(pl, coord3d(1, 5, 0), coord3d(14, 5, 0), rail, true), null)
	ASSERT_EQUAL(command_x.build_way(pl, coord3d(4, 5, 0), coord3d(4, 7, 0), rail, true), null)
	ASSERT_EQUAL(command_x.build_way(pl, coord3d(4, 7, 0), coord3d(10, 7, 0), rail, true), null)
	ASSERT_EQUAL(command_x.build_way(pl, coord3d(10, 7, 0), coord3d(10, 5, 0), rail, true), null)

	local station_desc = building_desc_x.get_available_stations(building_desc_x.station, wt_rail, good_desc_x.passenger)[0]
	foreach (x in [12, 13, 14]) {
		ASSERT_EQUAL(command_x.build_station(pl, coord3d(x, 5, 0), station_desc), null)
	}
	ASSERT_EQUAL(command_x.build_depot(pl, coord3d(1, 5, 0), get_depot_by_wt(wt_rail)), null)

	// a plain block signal for eastbound trains at (3,5)
	local sig = sign_desc_x.get_available_signs(wt_rail).filter(@(i, s) (s.is_signal() && !s.is_choose_sign() && !s.is_pre_signal() && !s.is_longblock_signal() && !s.is_priority_signal()))[0]
	local tile = tile_x(3, 5, 0)
	for (local i = 0; i < 4; i++) {
		ASSERT_EQUAL(command_x.build_sign_at(pl, tile, sig), null)
		if (tile.get_way(wt_rail).get_dirs_masked() == dir.east) {
			break
		}
	}
	ASSERT_EQUAL(tile.get_way(wt_rail).get_dirs_masked(), dir.east)

	local depot = depot_x(1, 5, 0)
	local loco = vehicle_desc_x.get_available_vehicles(wt_rail).filter(@(idx, v) (!v.needs_electrification() && v.can_be_first() && v.get_power() > 0))[0]
	ASSERT_TRUE(depot.append_vehicle(pl, convoy_x(0), loco))

	print("IL-TEST: layout ready")
	return depot
}

function start()
{
	build_layout()
}

function resume_game()
{
}
