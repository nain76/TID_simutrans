/*
 * This file is part of the Simutrans project under the Artistic License.
 * (see LICENSE.txt)
 */

// must be included before all simutrans headers (winsock)
#include "../network/network.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "il_bridge.h"
#include "il_manager.h"
#include "il_tool.h"

#include "../simdebug.h"
#include "../simworld.h"
#include "../simconvoi.h"
#include "../simversion.h"
#include "../pathes.h"
#include "../dataobj/environment.h"
#include "../utils/cbuffer_t.h"

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

#define IL_BRIDGE_MAX_CLIENTS 4
#define IL_BRIDGE_MAX_LINE 4096


namespace il_bridge {

struct client_t {
	SOCKET sock;
	char buf[IL_BRIDGE_MAX_LINE];
	size_t len;
};

static bool initialized = false;
static SOCKET listen_sock = INVALID_SOCKET;
static client_t clients[IL_BRIDGE_MAX_CLIENTS];

// the tool keeps a pointer to its default_param, so it must stay valid
static char tool_param[1024];


static int read_port()
{
	if(  const char *env = getenv("TID_IL_PORT")  ) {
		return atoi(env);
	}
	int port = 0;
	cbuffer_t path;
	path.printf("%s%s", env_t::user_dir ? env_t::user_dir : "", "interlocking.tab");
	if(  FILE *f = fopen(path, "r")  ) {
		char line[256];
		while(  fgets(line, sizeof(line), f)  ) {
			if(  strncmp(line, "port", 4) == 0  ) {
				const char *eq = strchr(line, '=');
				if(  eq  ) {
					port = atoi(eq + 1);
				}
			}
		}
		fclose(f);
	}
	return port;
}


static void init()
{
	initialized = true;
	for(  int i = 0;  i < IL_BRIDGE_MAX_CLIENTS;  i++  ) {
		clients[i].sock = INVALID_SOCKET;
		clients[i].len = 0;
	}

	const int port = read_port();
	if(  port <= 0  ||  port > 65535  ) {
		return;
	}

#if USE_WINSOCK
	WSADATA wsa;
	if(  WSAStartup(MAKEWORD(2, 2), &wsa) != 0  ) {
		dbg->warning("il_bridge::init()", "cannot start winsock");
		return;
	}
#endif

	SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
	if(  s == INVALID_SOCKET  ) {
		dbg->warning("il_bridge::init()", "cannot create socket");
		return;
	}
	int on = 1;
	setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (const char *)&on, sizeof(on));

	struct sockaddr_in addr;
	memset(&addr, 0, sizeof(addr));
	addr.sin_family = AF_INET;
	addr.sin_port = htons((unsigned short)port);
	addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // local only, never exposed to the network

	if(  bind(s, (struct sockaddr *)&addr, sizeof(addr)) != 0  ||  listen(s, 4) != 0  ) {
		dbg->warning("il_bridge::init()", "cannot listen on 127.0.0.1:%d", port);
		network_close_socket(s);
		return;
	}
	listen_sock = s;
	dbg->message("il_bridge::init()", "interlocking panel bridge listening on 127.0.0.1:%d", port);
}


static void close_client(client_t &c)
{
	if(  c.sock != INVALID_SOCKET  ) {
		network_close_socket(c.sock);
	}
	c.sock = INVALID_SOCKET;
	c.len = 0;
}


static void send_line(client_t &c, const char *text)
{
	if(  c.sock == INVALID_SOCKET  ) {
		return;
	}
	cbuffer_t line;
	line.append(text);
	line.append("\n");
	const char *p = line.get_str();
	size_t left = line.len();
	while(  left > 0  ) {
		const int sent = send(c.sock, p, (int)left, MSG_NOSIGNAL);
		if(  sent <= 0  ) {
			close_client(c);
			return;
		}
		p += sent;
		left -= sent;
	}
}


static void send_all(const char *text)
{
	for(  int i = 0;  i < IL_BRIDGE_MAX_CLIENTS;  i++  ) {
		send_line(clients[i], text);
	}
}


static void handle_line(client_t &c, char *line)
{
	// strip CR/LF and leading blanks
	size_t n = strlen(line);
	while(  n > 0  &&  (line[n - 1] == '\r'  ||  line[n - 1] == '\n'  ||  line[n - 1] == ' ')  ) {
		line[--n] = 0;
	}
	while(  *line == ' '  ) {
		line++;
	}
	if(  *line == 0  ) {
		return;
	}

	interlocking_manager_t *il = interlocking_manager_t::get();
	cbuffer_t answer;

	if(  strncmp(line, "cmd ", 4) == 0  ) {
		// all state changes go through the network safe tool
		tool_t *tool = tool_t::simple_tool[TOOL_INTERLOCKING];
		karte_t *welt = world();
		if(  tool == NULL  ||  welt == NULL  ) {
			send_line(c, "{\"type\":\"error\",\"error\":\"game not ready\"}");
			return;
		}
		strncpy(tool_param, line + 4, sizeof(tool_param) - 1);
		tool_param[sizeof(tool_param) - 1] = 0;
		tool->set_default_param(tool_param);
		welt->set_tool(tool, welt->get_active_player());
		// the result arrives as {"type":"result",...} event once the tool was executed
		return;
	}
	else if(  strcmp(line, "status") == 0  ) {
		il->get_status_json(answer);
	}
	else if(  strncmp(line, "signals ", 8) == 0  ) {
		int x1, y1, x2, y2;
		if(  sscanf(line + 8, "%d %d %d %d", &x1, &y1, &x2, &y2) == 4  ) {
			il->get_signals_json(answer, koord((sint16)x1, (sint16)y1), koord((sint16)x2, (sint16)y2));
		}
		else {
			answer.append("{\"type\":\"error\",\"error\":\"usage: signals x1 y1 x2 y2\"}");
		}
	}
	else if(  getenv("TID_IL_DEBUG")  &&  strncmp(line, "debug_tool ", 11) == 0  ) {
		// test helper (only with TID_IL_DEBUG set): run any simple tool, network safe like a GUI click
		int id = -1;
		char *p = line + 11;
		id = atoi(p);
		while(  *p  &&  *p != ' '  ) {
			p++;
		}
		if(  *p == ' '  ) {
			p++;
		}
		karte_t *welt = world();
		if(  id < 0  ||  id >= SIMPLE_TOOL_COUNT  ||  tool_t::simple_tool[id] == NULL  ||  welt == NULL  ) {
			answer.append("{\"type\":\"error\",\"error\":\"invalid tool\"}");
		}
		else {
			strncpy(tool_param, p, sizeof(tool_param) - 1);
			tool_param[sizeof(tool_param) - 1] = 0;
			tool_t::simple_tool[id]->set_default_param(tool_param);
			welt->set_tool(tool_t::simple_tool[id], welt->get_active_player());
			answer.append("{\"type\":\"debug_tool\",\"ok\":true}");
		}
	}
	else if(  getenv("TID_IL_DEBUG")  &&  strcmp(line, "debug_convoys") == 0  ) {
		// test helper (only with TID_IL_DEBUG set): list all convoys
		answer.append("{\"type\":\"convoys\",\"convoys\":[");
		bool first = true;
		FOR(vector_tpl<convoihandle_t>, const cnv, world()->convoys()) {
			const koord3d pos = cnv->get_pos();
			answer.printf("%s{\"id\":%u,\"pos\":[%d,%d,%d],\"state\":%d,\"speed\":%d}", first ? "" : ",", cnv.get_id(), pos.x, pos.y, pos.z, cnv->get_state(), cnv->get_akt_speed());
			first = false;
		}
		answer.append("]}");
	}
	else if(  getenv("TID_IL_DEBUG")  &&  strncmp(line, "debug_save ", 11) == 0  ) {
		// test helper (only with TID_IL_DEBUG set): save the game into the save folder
		cbuffer_t fn;
		fn.printf(SAVE_PATH_X "%s.sve", line + 11);
		world()->save(fn, false, SAVEGAME_VER_NR, true);
		answer.append("{\"type\":\"debug_save\",\"ok\":true}");
	}
	else if(  strcmp(line, "ping") == 0  ) {
		answer.append("{\"type\":\"pong\"}");
	}
	else {
		answer.append("{\"type\":\"error\",\"error\":\"unknown request (cmd, status, signals, ping)\"}");
	}
	send_line(c, answer);
}


static void read_client(client_t &c)
{
	char tmp[1024];
	const int got = recv(c.sock, tmp, sizeof(tmp), 0);
	if(  got <= 0  ) {
		close_client(c);
		return;
	}
	for(  int i = 0;  i < got  &&  c.sock != INVALID_SOCKET;  i++  ) {
		if(  tmp[i] == '\n'  ) {
			c.buf[c.len] = 0;
			c.len = 0;
			handle_line(c, c.buf);
		}
		else if(  c.len < IL_BRIDGE_MAX_LINE - 1  ) {
			c.buf[c.len++] = tmp[i];
		}
	}
}


void poll()
{
	if(  !initialized  ) {
		init();
	}
	if(  listen_sock == INVALID_SOCKET  ) {
		return;
	}

	fd_set fds;
	FD_ZERO(&fds);
	FD_SET(listen_sock, &fds);
	SOCKET max_sock = listen_sock;
	for(  int i = 0;  i < IL_BRIDGE_MAX_CLIENTS;  i++  ) {
		if(  clients[i].sock != INVALID_SOCKET  ) {
			FD_SET(clients[i].sock, &fds);
			if(  clients[i].sock > max_sock  ) {
				max_sock = clients[i].sock;
			}
		}
	}
	struct timeval tv = { 0, 0 };
	if(  select((int)max_sock + 1, &fds, NULL, NULL, &tv) > 0  ) {
		if(  FD_ISSET(listen_sock, &fds)  ) {
			SOCKET s = accept(listen_sock, NULL, NULL);
			if(  s != INVALID_SOCKET  ) {
				int slot = -1;
				for(  int i = 0;  i < IL_BRIDGE_MAX_CLIENTS;  i++  ) {
					if(  clients[i].sock == INVALID_SOCKET  ) {
						slot = i;
						break;
					}
				}
				if(  slot < 0  ) {
					network_close_socket(s);
				}
				else {
#ifdef SO_NOSIGPIPE
					// macOS has no MSG_NOSIGNAL: a closed panel must not kill the game
					int on = 1;
					setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, (const char *)&on, sizeof(on));
#endif
					clients[slot].sock = s;
					clients[slot].len = 0;
					send_line(clients[slot], "{\"type\":\"hello\",\"protocol\":1}");
				}
			}
		}
		for(  int i = 0;  i < IL_BRIDGE_MAX_CLIENTS;  i++  ) {
			if(  clients[i].sock != INVALID_SOCKET  &&  FD_ISSET(clients[i].sock, &fds)  ) {
				read_client(clients[i]);
			}
		}
	}

	// forward the events of the interlocking to all panels
	cbuffer_t ev;
	while(  interlocking_manager_t::get()->pop_event(ev)  ) {
		send_all(ev);
		ev.clear();
	}
}


void shutdown()
{
	for(  int i = 0;  i < IL_BRIDGE_MAX_CLIENTS;  i++  ) {
		close_client(clients[i]);
	}
	if(  listen_sock != INVALID_SOCKET  ) {
		network_close_socket(listen_sock);
		listen_sock = INVALID_SOCKET;
	}
}

} // namespace il_bridge
