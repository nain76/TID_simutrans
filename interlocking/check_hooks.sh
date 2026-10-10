#!/bin/sh
# Checks that all hooks of the TID interlocking panel are present in the OTRP core
# and that the core functions used by interlocking/ still exist.
# Run from the repository root:  sh interlocking/check_hooks.sh
# See interlocking/PORTING.md

fail=0

need() { # need <file> <pattern> <count> <description>
	n=$(grep -c -- "$2" "$1" 2>/dev/null)
	if [ "$n" -ge "$3" ]; then
		echo "  OK    $4"
	else
		echo "  MISS  $4  ($1: '$2' found $n, expected $3)"
		fail=1
	fi
}

echo "hooks in the core (// TID_IL):"
need vehicle/simvehicle.cc 'interlocking/interlocking.h" // TID_IL' 1 "H1 include in vehicle/simvehicle.cc"
need vehicle/simvehicle.cc 'TID_IL H1' 1 "H1 signal hook in rail_vehicle_t::is_signal_clear()"
need vehicle/simvehicle.cc 'TID_IL H8' 1 "H8 departure hook in rail_vehicle_t::can_enter_tile() (CAN_START)"
need simworld.cc 'interlocking/interlocking.h" // TID_IL' 1 "include in simworld.cc"
need simworld.cc 'TID_IL H2' 1 "H2 karte_t::step()"
need simworld.cc 'TID_IL H3' 3 "H3 save / load / load finished"
need simworld.cc 'TID_IL H4' 2 "H4 rotate90 / destroy"
need simworld.cc 'TID_IL H5' 1 "H5 main loop"
need simmenu.h 'TOOL_INTERLOCKING, // TID_IL H6' 1 "H6 tool id"
need simmenu.cc 'TID_IL H6' 2 "H6 tool name / creation"
need simmenu.cc 'interlocking/il_tool.h" // TID_IL' 1 "H6 include in simmenu.cc"
need Makefile 'interlocking/il_' 5 "H7 Makefile sources"
need cmake/SimutransSourceList.cmake 'interlocking/il_' 5 "H7 CMake sources"
need Simutrans-Main.vcxitems 'interlocking\\il_' 5 "H7 Visual Studio sources"

echo "core functions used by interlocking/:"
need vehicle/simvehicle.h 'bool block_reserver(const route_t \*route, uint16 start_index' 1 "rail_vehicle_t::block_reserver()"
need vehicle/simvehicle.h 'bool is_signal_clear(uint16' 1 "rail_vehicle_t::is_signal_clear()"
need simconvoi.h 'route_t\* access_route()' 1 "convoi_t::access_route()"
need simconvoi.h 'void set_next_stop_index(uint16' 1 "convoi_t::set_next_stop_index()"
need simconvoi.h 'get_coupling_convoi()' 1 "convoi_t::get_coupling_convoi()"
need boden/wege/schiene.h 'get_reserved_convoi()' 1 "schiene_t::get_reserved_convoi()"
need dataobj/route.h 'route_result_t calc_route(karte_t' 1 "route_t::calc_route()"
need boden/grund.h 'bool get_neighbour(grund_t' 1 "grund_t::get_neighbour()"
need simworld.cc 'rdwr_all_win' 2 "window data is still the last block of the savegame"

if [ $fail -ne 0 ]; then
	echo "=> something is missing, see interlocking/PORTING.md"
	exit 1
fi
echo "=> all hooks present"
