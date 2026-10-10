/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "il_manager.h"

#include "../simworld.h"
#include "../simconvoi.h"
#include "../simhalt.h"
#include "../boden/grund.h"
#include "../boden/wege/schiene.h"
#include "../obj/signal.h"
#include "../vehicle/simvehicle.h"
#include "../dataobj/loadsave.h"
#include "../dataobj/route.h"
#include "../dataobj/ribi.h"
#include "../player/simplay.h"
#include "../utils/cbuffer_t.h"


// version of the interlocking data block in the savegame (independent of the OTRP version)
#define IL_SAVE_VERSION 1

// maximum number of tiles searched when defining a route
#define IL_MAX_SEARCH_NODES 4096

// maximum number of tiles a route may have
#define IL_MAX_ROUTE_TILES 1024

// maximum number of pending events for the external panel
#define IL_MAX_EVENTS 256


static interlocking_manager_t *il_instance = NULL;


interlocking_manager_t *interlocking_manager_t::get()
{
	if(  il_instance == NULL  ) {
		il_instance = new interlocking_manager_t();
	}
	return il_instance;
}


void interlocking_manager_t::reset()
{
	clear_ptr_vector(stations);
	clear_ptr_vector(routes);
	next_id = 1;
	push_event("{\"type\":\"reset\"}");
}


// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

static const char *state_name(uint8 state)
{
	switch(  state  ) {
		case IL_SET:      return "set";
		case IL_OCCUPIED: return "occupied";
		default:          return "idle";
	}
}


static void append_json_string(cbuffer_t &buf, const char *s)
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


static void append_json_pos(cbuffer_t &buf, koord3d pos)
{
	buf.printf("[%d,%d,%d]", pos.x, pos.y, pos.z);
}


static schiene_t *get_rail(koord3d pos)
{
	grund_t *gr = world()->lookup(pos);
	return gr ? (schiene_t *)gr->get_weg(track_wt) : NULL;
}


static signal_t *get_signal(koord3d pos)
{
	grund_t *gr = world()->lookup(pos);
	return gr ? gr->find<signal_t>() : NULL;
}


il_station_t *interlocking_manager_t::find_station(uint16 id) const
{
	FOR(vector_tpl<il_station_t *>, st, stations) {
		if(  st->id == id  ) {
			return st;
		}
	}
	return NULL;
}


il_route_t *interlocking_manager_t::find_route(uint16 id) const
{
	FOR(vector_tpl<il_route_t *>, r, routes) {
		if(  r->id == id  ) {
			return r;
		}
	}
	return NULL;
}


const il_route_t *interlocking_manager_t::get_route(uint16 id) const
{
	return find_route(id);
}


il_station_t *interlocking_manager_t::find_station_of_signal(koord3d pos) const
{
	FOR(vector_tpl<il_station_t *>, st, stations) {
		if(  st->signals.is_contained(pos)  ) {
			return st;
		}
	}
	return NULL;
}


bool interlocking_manager_t::may_operate(const il_station_t *st, const player_t *player) const
{
	return player_t::check_owner(world()->get_player(st->owner), player);
}


void interlocking_manager_t::push_event(const char *json)
{
	// events are only for the local external panel; drop the oldest when nobody reads them
	if(  events.get_count() >= IL_MAX_EVENTS  ) {
		events.remove_at(0);
	}
	events.append(plainstring(json));
}


bool interlocking_manager_t::pop_event(cbuffer_t &buf)
{
	if(  events.empty()  ) {
		return false;
	}
	buf.append(events[0].c_str());
	events.remove_at(0);
	return true;
}


void interlocking_manager_t::set_route_state(il_route_t *r, uint8 state)
{
	if(  r->state == state  ) {
		return;
	}
	r->state = state;
	if(  state != IL_OCCUPIED  ) {
		r->convoy = convoihandle_t();
	}
	cbuffer_t buf;
	buf.printf("{\"type\":\"route\",\"id\":%u,\"station\":%u,\"state\":\"%s\"", r->id, r->station, state_name(state));
	if(  state == IL_OCCUPIED  &&  r->convoy.is_bound()  ) {
		buf.append(",\"convoy\":");
		append_json_string(buf, r->convoy->get_name());
	}
	buf.append("}");
	push_event(buf);
}


// ---------------------------------------------------------------------------
// route search (used only when a route is defined)
// ---------------------------------------------------------------------------

bool interlocking_manager_t::find_path(koord3d start, koord3d end, vector_tpl<koord3d> &tiles)
{
	struct node_t {
		koord3d pos;
		ribi_t::ribi dir;   ///< direction of travel when entering this tile
		sint32 parent;
	};
	vector_tpl<node_t> nodes;

	tiles.clear();

	grund_t *gr = world()->lookup(start);
	weg_t *w = gr ? gr->get_weg(track_wt) : NULL;
	if(  w == NULL  ) {
		return false;
	}

	node_t first;
	first.pos = start;
	first.dir = ribi_t::none;
	first.parent = -1;
	nodes.append(first);

	for(  uint32 i = 0;  i < nodes.get_count()  &&  nodes.get_count() < IL_MAX_SEARCH_NODES;  i++  ) {
		const node_t cur = nodes[i];
		if(  i > 0  &&  cur.pos == end  ) {
			// found: collect the tiles backwards
			vector_tpl<koord3d> rev;
			for(  sint32 n = (sint32)i;  n >= 0;  n = nodes[n].parent  ) {
				rev.append(nodes[n].pos);
			}
			for(  sint32 n = (sint32)rev.get_count() - 1;  n >= 0;  n--  ) {
				tiles.append(rev[n]);
			}
			return tiles.get_count() <= IL_MAX_ROUTE_TILES;
		}

		grund_t *g = world()->lookup(cur.pos);
		weg_t *way = g ? g->get_weg(track_wt) : NULL;
		if(  way == NULL  ) {
			continue;
		}
		// get_ribi() respects the masks of one way signals, so a train can only leave
		// the start signal in its direction of travel
		ribi_t::ribi exits = way->get_ribi();
		if(  cur.dir != ribi_t::none  ) {
			// no reversing on the track
			exits &= ~ribi_t::backward(cur.dir);
		}
		for(  int d = 0;  d < 4;  d++  ) {
			const ribi_t::ribi dir = ribi_t::nesw[d];
			if(  (exits & dir) == 0  ) {
				continue;
			}
			grund_t *to = NULL;
			if(  !g->get_neighbour(to, track_wt, dir)  ) {
				continue;
			}
			const koord3d npos = to->get_pos();
			// visited with the same direction?
			bool visited = false;
			FOR(vector_tpl<node_t>, const &n, nodes) {
				if(  n.pos == npos  &&  n.dir == dir  ) {
					visited = true;
					break;
				}
			}
			if(  visited  ) {
				continue;
			}
			node_t nn;
			nn.pos = npos;
			nn.dir = dir;
			nn.parent = (sint32)i;
			nodes.append(nn);
		}
	}
	return false;
}


// ---------------------------------------------------------------------------
// commands (executed on all clients by tool_interlocking_t)
// ---------------------------------------------------------------------------

// splits param at commas; the last field takes the rest of the string
static uint32 split_param(char *buf, char **fields, uint32 max_fields)
{
	uint32 n = 0;
	char *p = buf;
	while(  n < max_fields  ) {
		fields[n++] = p;
		if(  n == max_fields  ) {
			break;
		}
		char *c = strchr(p, ',');
		if(  c == NULL  ) {
			break;
		}
		*c = 0;
		p = c + 1;
	}
	return n;
}


const char *interlocking_manager_t::execute(const char *param, player_t *player)
{
	if(  param == NULL  ) {
		return "no command";
	}

	char buf[1024];
	strncpy(buf, param, sizeof(buf) - 1);
	buf[sizeof(buf) - 1] = 0;

	// names may contain commas: they are the last field of st_new and rt_def
	uint32 max_fields = 10;
	if(  strncmp(buf, "st_new,", 7) == 0  ) {
		max_fields = 2;
	}
	else if(  strncmp(buf, "rt_def,", 7) == 0  ) {
		max_fields = 9;
	}
	char *f[10];
	const uint32 n = split_param(buf, f, max_fields);
	const char *cmd = f[0];
	const char *error = NULL;

	if(  strcmp(cmd, "st_new") == 0  &&  n >= 2  ) {
		il_station_t *st = new il_station_t();
		st->id = next_id++;
		st->name = f[1];
		st->owner = player ? player->get_player_nr() : 1;
		st->manual = false;
		stations.append(st);
		cbuffer_t ev;
		ev.printf("{\"type\":\"station\",\"id\":%u,\"name\":", st->id);
		append_json_string(ev, st->name.c_str());
		ev.append("}");
		push_event(ev);
	}
	else if(  strcmp(cmd, "st_del") == 0  &&  n >= 2  ) {
		il_station_t *st = find_station((uint16)atoi(f[1]));
		if(  st == NULL  ) {
			error = "unknown station";
		}
		else if(  !may_operate(st, player)  ) {
			error = "not owner";
		}
		else {
			for(  uint32 i = routes.get_count();  i-- > 0;  ) {
				if(  routes[i]->station == st->id  ) {
					delete routes[i];
					routes.remove_at(i);
				}
			}
			stations.remove(st);
			delete st;
		}
	}
	else if(  strcmp(cmd, "st_mode") == 0  &&  n >= 3  ) {
		il_station_t *st = find_station((uint16)atoi(f[1]));
		if(  st == NULL  ) {
			error = "unknown station";
		}
		else if(  !may_operate(st, player)  ) {
			error = "not owner";
		}
		else {
			st->manual = atoi(f[2]) != 0;
			if(  !st->manual  ) {
				// back to automatic: all routes waiting for a train are cancelled
				FOR(vector_tpl<il_route_t *>, r, routes) {
					if(  r->station == st->id  &&  r->state == IL_SET  ) {
						set_route_state(r, IL_IDLE);
					}
				}
			}
			cbuffer_t ev;
			ev.printf("{\"type\":\"mode\",\"station\":%u,\"manual\":%s}", st->id, st->manual ? "true" : "false");
			push_event(ev);
		}
	}
	else if(  (strcmp(cmd, "sig_add") == 0  ||  strcmp(cmd, "sig_del") == 0)  &&  n >= 5  ) {
		il_station_t *st = find_station((uint16)atoi(f[1]));
		const koord3d pos((sint16)atoi(f[2]), (sint16)atoi(f[3]), (sint8)atoi(f[4]));
		if(  st == NULL  ) {
			error = "unknown station";
		}
		else if(  !may_operate(st, player)  ) {
			error = "not owner";
		}
		else if(  cmd[4] == 'a'  ) {
			il_station_t *other = find_station_of_signal(pos);
			if(  get_signal(pos) == NULL  ||  get_rail(pos) == NULL  ) {
				error = "no rail signal at this position";
			}
			else if(  other  ) {
				error = other == st ? "signal already registered" : "signal belongs to another station";
			}
			else {
				st->signals.append(pos);
			}
		}
		else {
			if(  !st->signals.remove(pos)  ) {
				error = "signal not registered";
			}
		}
	}
	else if(  strcmp(cmd, "rt_def") == 0  &&  n >= 8  ) {
		il_station_t *st = find_station((uint16)atoi(f[1]));
		const koord3d start((sint16)atoi(f[2]), (sint16)atoi(f[3]), (sint8)atoi(f[4]));
		const koord3d end((sint16)atoi(f[5]), (sint16)atoi(f[6]), (sint8)atoi(f[7]));
		vector_tpl<koord3d> tiles;
		if(  st == NULL  ) {
			error = "unknown station";
		}
		else if(  !may_operate(st, player)  ) {
			error = "not owner";
		}
		else if(  !st->signals.is_contained(start)  ) {
			error = "start is not a registered signal of this station";
		}
		else if(  start == end  ) {
			error = "start and end are the same tile";
		}
		else if(  !find_path(start, end, tiles)  ) {
			error = "no track from the start signal to the end tile";
		}
		else {
			il_route_t *r = new il_route_t();
			r->id = next_id++;
			r->station = st->id;
			r->name = n >= 9 ? f[8] : "";
			FOR(vector_tpl<koord3d>, const &t, tiles) {
				r->tiles.append(t);
			}
			r->state = IL_IDLE;
			routes.append(r);
			cbuffer_t ev;
			ev.printf("{\"type\":\"route_defined\",\"id\":%u,\"station\":%u,\"tiles\":%u}", r->id, st->id, r->tiles.get_count());
			push_event(ev);
		}
	}
	else if(  strcmp(cmd, "rt_del") == 0  &&  n >= 2  ) {
		il_route_t *r = find_route((uint16)atoi(f[1]));
		il_station_t *st = r ? find_station(r->station) : NULL;
		if(  r == NULL  ||  st == NULL  ) {
			error = "unknown route";
		}
		else if(  !may_operate(st, player)  ) {
			error = "not owner";
		}
		else if(  r->state == IL_OCCUPIED  ) {
			error = "route is occupied";
		}
		else {
			routes.remove(r);
			delete r;
		}
	}
	else if(  (strcmp(cmd, "set") == 0  ||  strcmp(cmd, "cancel") == 0)  &&  n >= 2  ) {
		il_route_t *r = find_route((uint16)atoi(f[1]));
		il_station_t *st = r ? find_station(r->station) : NULL;
		if(  r == NULL  ||  st == NULL  ) {
			error = "unknown route";
		}
		else if(  !may_operate(st, player)  ) {
			error = "not owner";
		}
		else if(  cmd[0] == 's'  ) {
			error = st->manual ? cmd_set(r) : "station is in automatic mode";
		}
		else {
			error = cmd_cancel(r);
		}
	}
	else {
		error = "unknown command or missing parameters";
	}

	cbuffer_t ev;
	ev.append("{\"type\":\"result\",\"command\":");
	append_json_string(ev, param);
	ev.printf(",\"ok\":%s", error ? "false" : "true");
	if(  error  ) {
		ev.append(",\"error\":");
		append_json_string(ev, error);
	}
	ev.append("}");
	push_event(ev);

	return error;
}


const char *interlocking_manager_t::cmd_set(il_route_t *r)
{
	if(  r->state != IL_IDLE  ) {
		return "route is not idle";
	}
	// conflicting routes: any other route that is set and shares a tile
	FOR(vector_tpl<il_route_t *>, o, routes) {
		if(  o == r  ||  o->state != IL_SET  ) {
			continue;
		}
		if(  o->tiles[0] == r->tiles[0]  ) {
			return "another route from this signal is set";
		}
		FOR(vector_tpl<koord3d>, const &t, r->tiles) {
			if(  o->tiles.is_contained(t)  ) {
				return "conflicting route is set";
			}
		}
	}
	// the track must exist and be free; tiles[0] (the signal) belongs to the block in front of it
	for(  uint32 i = 1;  i < r->tiles.get_count();  i++  ) {
		schiene_t *sch = get_rail(r->tiles[i]);
		if(  sch == NULL  ) {
			return "track of the route is missing";
		}
		if(  sch->is_reserved()  ) {
			return "track is occupied";
		}
	}
	if(  get_signal(r->tiles[0]) == NULL  ) {
		return "start signal is missing";
	}
	set_route_state(r, IL_SET);
	return NULL;
}


const char *interlocking_manager_t::cmd_cancel(il_route_t *r)
{
	if(  r->state == IL_OCCUPIED  ) {
		return "train already admitted";
	}
	if(  r->state == IL_IDLE  ) {
		return "route is not set";
	}
	set_route_state(r, IL_IDLE);
	return NULL;
}


// ---------------------------------------------------------------------------
// signal hook
// ---------------------------------------------------------------------------

bool interlocking_manager_t::build_train_route(rail_vehicle_t *v, uint16 next_block, const il_route_t *r, vector_tpl<koord3d> &out) const
{
	convoi_t *cnv = v->get_convoi();
	const route_t *rt = cnv->get_route();
	const koord3d dest = rt->back();
	const uint32 count = r->tiles.get_count();

	out.clear();

	// 1. the destination lies on the interlocking route: stop there
	FOR(vector_tpl<koord3d>, const &t, r->tiles) {
		out.append(t);
		if(  t == dest  ) {
			return true;
		}
	}

	const koord3d end = r->tiles[count - 1];
	const halthandle_t end_halt = haltestelle_t::get_halt(end, cnv->get_owner());
	const halthandle_t dest_halt = haltestelle_t::get_halt(dest, cnv->get_owner());

	// 2. the route ends on a platform of the destination stop: go on to the end of that platform
	if(  end_halt.is_bound()  &&  end_halt == dest_halt  &&  count >= 2  ) {
		const ribi_t::ribi dir = ribi_type(r->tiles[count - 2], end);
		grund_t *gr = world()->lookup(end);
		for(  int i = 0;  gr  &&  i < 256;  i++  ) {
			grund_t *to = NULL;
			weg_t *w = gr->get_weg(track_wt);
			if(  !w  ||  (w->get_ribi() & dir) == 0  ||  !gr->get_neighbour(to, track_wt, dir)  ) {
				break;
			}
			if(  haltestelle_t::get_halt(to->get_pos(), cnv->get_owner()) != end_halt  ) {
				break;
			}
			out.append(to->get_pos());
			gr = to;
		}
		return true;
	}

	// 3. otherwise continue from the end of the route to the destination
	route_t ext;
	const uint16 len = world()->get_settings().get_advance_to_end() ? 8888 : cnv->get_entire_convoy_length();
	if(  !ext.calc_route(world(), end, dest, v, speed_to_kmh(cnv->get_min_top_speed()), len, cnv->needs_electrification())  ) {
		return false;
	}
	if(  ext.get_count() < 2  ) {
		return true;
	}
	if(  count >= 2  &&  ext.at(1) == r->tiles[count - 2]  ) {
		// the train would have to reverse at the end of the route
		return false;
	}
	for(  uint32 i = 1;  i < ext.get_count();  i++  ) {
		out.append(ext.at(i));
	}
	(void)next_block;
	return true;
}


bool interlocking_manager_t::on_signal(rail_vehicle_t *v, uint16 next_block, sint32 &restart_speed, bool &result)
{
	convoi_t *cnv = v->get_convoi();
	if(  cnv == NULL  ||  next_block >= cnv->get_route()->get_count()  ) {
		return false;
	}
	const koord3d spos = cnv->get_route()->at(next_block);
	il_station_t *st = find_station_of_signal(spos);
	if(  st == NULL  ||  !st->manual  ) {
		// not interlocked or automatic mode: the core handles the signal as usual
		return false;
	}
	signal_t *sig = get_signal(spos);
	if(  sig == NULL  ) {
		return false;
	}

	// find the route that is set from this signal (or already admitted this train)
	il_route_t *r = NULL;
	FOR(vector_tpl<il_route_t *>, rr, routes) {
		if(  rr->tiles[0] != spos  ) {
			continue;
		}
		if(  rr->state == IL_SET  ||  (rr->state == IL_OCCUPIED  &&  rr->convoy == cnv->self)  ) {
			r = rr;
			break;
		}
	}

	if(  r == NULL  ) {
		// no route: the signal stays at danger
		sig->set_state(roadsign_t::STATE_RED);
		restart_speed = 0;
		result = false;
		return true;
	}

	if(  r->state == IL_SET  ) {
		vector_tpl<koord3d> tiles;
		if(  !build_train_route(v, next_block, r, tiles)  ) {
			// report only once per route and train (the train checks the signal again and again)
			const uint32 key = ((uint32)r->id << 16) | cnv->self.get_id();
			if(  key != last_wrong_route  ) {
				last_wrong_route = key;
				cbuffer_t ev;
				ev.printf("{\"type\":\"wrong_route\",\"id\":%u,\"convoy\":", r->id);
				append_json_string(ev, cnv->get_name());
				ev.append("}");
				push_event(ev);
			}
			sig->set_state(roadsign_t::STATE_RED);
			restart_speed = 0;
			result = false;
			return true;
		}
		route_t target_rt;
		FOR(vector_tpl<koord3d>, const &t, tiles) {
			target_rt.append(t);
		}
		// same as the choose signal: replace the route of the train (and of coupled trains)
		convoihandle_t c = cnv->self;
		while(  c.is_bound()  ) {
			c->access_route()->remove_koord_from(next_block);
			c->access_route()->append(&target_rt);
			c = c->get_coupling_convoi();
		}
	}

	uint16 next_signal, next_crossing;
	if(  v->block_reserver(cnv->get_route(), next_block + 1, next_signal, next_crossing, 0, true, false)  ) {
		sig->set_state(roadsign_t::STATE_GREEN);
		cnv->set_next_stop_index(min(next_crossing, next_signal));
		r->convoy = cnv->self;
		set_route_state(r, IL_OCCUPIED);
		result = true;
		return true;
	}

	sig->set_state(roadsign_t::STATE_RED);
	restart_speed = 0;
	result = false;
	return true;
}


// ---------------------------------------------------------------------------
// step: automatic release (approximation of the route section locking)
// ---------------------------------------------------------------------------

void interlocking_manager_t::step()
{
	FOR(vector_tpl<il_route_t *>, r, routes) {
		if(  r->state != IL_OCCUPIED  ) {
			continue;
		}
		// the route is released as soon as the train no longer holds the first tile behind the signal;
		// the rest of the route is still protected by the reservation of the train itself
		schiene_t *sch = r->tiles.get_count() > 1 ? get_rail(r->tiles[1]) : NULL;
		const convoihandle_t holder = sch ? sch->get_reserved_convoi() : convoihandle_t();
		if(  !r->convoy.is_bound()  &&  holder.is_bound()  ) {
			// after loading: the admitted train is not saved, take it from the reservation
			r->convoy = holder;
		}
		if(  !holder.is_bound()  ||  holder != r->convoy  ) {
			set_route_state(r, IL_IDLE);
		}
	}
}


// ---------------------------------------------------------------------------
// load / save / rotate
// ---------------------------------------------------------------------------

static void rdwr_pos_vector(loadsave_t *file, vector_tpl<koord3d> &v)
{
	uint32 count = v.get_count();
	file->rdwr_long(count);
	if(  file->is_loading()  ) {
		v.clear();
		for(  uint32 i = 0;  i < count;  i++  ) {
			koord3d k;
			k.rdwr(file);
			v.append(k);
		}
	}
	else {
		for(  uint32 i = 0;  i < count;  i++  ) {
			v[i].rdwr(file);
		}
	}
}


void interlocking_manager_t::rdwr(loadsave_t *file)
{
	uint16 version = IL_SAVE_VERSION;
	file->rdwr_short(version);
	if(  file->is_loading()  ) {
		reset();
	}
	file->rdwr_short(next_id);

	uint32 count = stations.get_count();
	file->rdwr_long(count);
	for(  uint32 i = 0;  i < count;  i++  ) {
		il_station_t *st = file->is_loading() ? new il_station_t() : stations[i];
		file->rdwr_short(st->id);
		file->rdwr_str(st->name);
		file->rdwr_byte(st->owner);
		file->rdwr_bool(st->manual);
		rdwr_pos_vector(file, st->signals);
		if(  file->is_loading()  ) {
			stations.append(st);
		}
	}

	count = routes.get_count();
	file->rdwr_long(count);
	for(  uint32 i = 0;  i < count;  i++  ) {
		il_route_t *r = file->is_loading() ? new il_route_t() : routes[i];
		file->rdwr_short(r->id);
		file->rdwr_short(r->station);
		file->rdwr_str(r->name);
		file->rdwr_byte(r->state);
		rdwr_pos_vector(file, r->tiles);
		if(  file->is_loading()  ) {
			r->convoy = convoihandle_t();
			if(  r->tiles.empty()  ) {
				delete r;
				continue;
			}
			routes.append(r);
		}
	}
}


void interlocking_manager_t::rotate90(sint16 y_size)
{
	FOR(vector_tpl<il_station_t *>, st, stations) {
		for(  uint32 i = 0;  i < st->signals.get_count();  i++  ) {
			st->signals[i].rotate90(y_size);
		}
	}
	FOR(vector_tpl<il_route_t *>, r, routes) {
		for(  uint32 i = 0;  i < r->tiles.get_count();  i++  ) {
			r->tiles[i].rotate90(y_size);
		}
	}
	push_event("{\"type\":\"rotated\"}");
}


// ---------------------------------------------------------------------------
// read only information for the external panel
// ---------------------------------------------------------------------------

void interlocking_manager_t::get_status_json(cbuffer_t &buf) const
{
	buf.append("{\"type\":\"status\",\"stations\":[");
	bool first = true;
	FOR(vector_tpl<il_station_t *>, st, stations) {
		buf.append(first ? "" : ",");
		first = false;
		buf.printf("{\"id\":%u,\"name\":", st->id);
		append_json_string(buf, st->name.c_str());
		buf.printf(",\"owner\":%u,\"manual\":%s,\"signals\":[", st->owner, st->manual ? "true" : "false");
		for(  uint32 i = 0;  i < st->signals.get_count();  i++  ) {
			const koord3d pos = st->signals[i];
			signal_t *sig = get_signal(pos);
			buf.append(i ? "," : "");
			buf.append("{\"pos\":");
			append_json_pos(buf, pos);
			buf.printf(",\"aspect\":\"%s\"}", sig == NULL ? "missing" : sig->get_state() == roadsign_t::STATE_GREEN ? "green" : sig->get_state() == roadsign_t::STATE_YELLOW ? "yellow" : "red");
		}
		buf.append("]}");
	}
	buf.append("],\"routes\":[");
	first = true;
	FOR(vector_tpl<il_route_t *>, r, routes) {
		buf.append(first ? "" : ",");
		first = false;
		buf.printf("{\"id\":%u,\"station\":%u,\"name\":", r->id, r->station);
		append_json_string(buf, r->name.c_str());
		buf.printf(",\"state\":\"%s\",\"start\":", state_name(r->state));
		append_json_pos(buf, r->tiles[0]);
		buf.append(",\"end\":");
		append_json_pos(buf, r->tiles.back());
		// occupation of the route tiles: 1 = reserved by a train
		buf.append(",\"occupied\":[");
		for(  uint32 i = 0;  i < r->tiles.get_count();  i++  ) {
			const schiene_t *sch = get_rail(r->tiles[i]);
			buf.append(i ? "," : "");
			buf.append(sch  &&  sch->is_reserved() ? "1" : "0");
		}
		buf.append("],\"tiles\":[");
		for(  uint32 i = 0;  i < r->tiles.get_count();  i++  ) {
			buf.append(i ? "," : "");
			append_json_pos(buf, r->tiles[i]);
		}
		buf.append("]}");
	}
	buf.append("]}");
}


void interlocking_manager_t::get_signals_json(cbuffer_t &buf, koord p1, koord p2) const
{
	const sint16 x1 = min(p1.x, p2.x), x2 = max(p1.x, p2.x);
	const sint16 y1 = min(p1.y, p2.y), y2 = max(p1.y, p2.y);
	buf.append("{\"type\":\"signals\",\"signals\":[");
	bool first = true;
	uint32 found = 0;
	for(  sint16 y = y1;  y <= y2  &&  found < 1000;  y++  ) {
		for(  sint16 x = x1;  x <= x2  &&  found < 1000;  x++  ) {
			const planquadrat_t *plan = world()->access(koord(x, y));
			if(  plan == NULL  ) {
				continue;
			}
			for(  uint8 i = 0;  i < plan->get_boden_count();  i++  ) {
				grund_t *gr = plan->get_boden_bei(i);
				signal_t *sig = gr ? gr->find<signal_t>() : NULL;
				if(  sig == NULL  ) {
					continue;
				}
				buf.append(first ? "" : ",");
				first = false;
				found++;
				buf.append("{\"pos\":");
				append_json_pos(buf, gr->get_pos());
				buf.printf(",\"dir\":%u,\"name\":", (unsigned)sig->get_dir());
				append_json_string(buf, sig->get_desc()->get_name());
				const il_station_t *st = find_station_of_signal(gr->get_pos());
				buf.printf(",\"station\":%d}", st ? (int)st->id : -1);
			}
		}
	}
	buf.append("]}");
}
