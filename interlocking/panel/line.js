// TID interlocking panel: line panels (路線盤) for the view of all trains (全区間在線), drawn like the TID
// (blue). A line panel is a drawing of a whole line, kept in the game (saved with it, the same for everybody,
// open to everybody like the shared diagram). The grid has 2 steps per tile, as on a custom panel.
// Parts: T track (x1,y1)-(x2,y2) standing for the game tiles in b, W train number window between stations
// (rectangle, f = direction of the trains it shows, as a ribi; 0 = not known), B number box on a platform
// track (rectangle on the track, f bit 0: the delay box below it, else above), H platform of a station
// drawn small (rectangle), N station name (f bit 0: small, without a box), L text, F frame, C clock.
// Texts and names are kept encoded (encodeURIComponent).
"use strict";

const lineCache = new Map();   // line id -> { rev, parts }
let lineFetching = 0;
let lnEdit = null;             // editing: { id, parts, sel, tool, undo, redo, last, dirty, rev }
let lineView = localStore("line.view") || "map";   // "map" (the map of the game) or the id of a line panel
// what the windows show: the train number (列番), the name of the schedule (スケジュール名) or of the train (編成名)
let lineLabelMode = ["number", "line", "name"].includes(localStore("line.label")) ? localStore("line.label") : "number";
let lnPick = null;             // choosing the range of a new line panel on the map: { name, from, to }
const LINE_PART_TYPES = "TWBHNLFCY";
const lineName = (ln) => { try { return decodeURIComponent(ln.name); } catch (e) { return ln.name; } };
const linesOf = () => status.lines || [];
const shownLine = () => lineView === "map" ? null : linesOf().find(ln => String(ln.id) === String(lineView)) || null;

function lineParts(ln) {
	if (!ln) return null;
	const c = lineCache.get(ln.id);
	if ((!c || c.rev !== ln.rev) && lineFetching !== ln.id) {
		lineFetching = ln.id;
		api("/api/line?id=" + ln.id).then(r => { lineCache.set(ln.id, { rev: r.rev, parts: r.parts }); lineFetching = 0; renderNetwork(); }).catch(() => { lineFetching = 0; });
	}
	return c ? c.parts : null;
}

// upload: ln_begin, ln_add,<parts> ... (each command below ~3500 characters), ln_end,<count>
async function uploadLine(id, parts) {
	const enc = (p) => [p.t, p.x1, p.y1, p.x2, p.y2, p.f || 0, (p.b || []).map(t => t.join(":")).join("+"), p.s || ""].join("/");
	const send = (cmd) => fetch("/api/cmd", { method: "POST", headers: { "X-IL-Panel": "1", "Content-Type": "text/plain; charset=utf-8" }, body: cmd });
	await send(`ln_begin,${id}`);
	let chunk = [], len = 0;
	for (const p of parts) {
		const e = enc(p);
		if (len + e.length > 3500 && chunk.length) { await send(`ln_add,${id},${chunk.join(";")}`); chunk = []; len = 0; }
		chunk.push(e); len += e.length + 1;
	}
	if (chunk.length) await send(`ln_add,${id},${chunk.join(";")}`);
	return commandResult(`ln_end,${id},${parts.length}`);
}

// ---------------------------------------------------------------------------
// draft from the tracks of the whole network (/api/network): long plain stretches are shortened, stations
// get number boxes on their platform tracks (stations with points) or a platform mark, and the blocks
// between stations a train number window
// ---------------------------------------------------------------------------
const LINE_KEEP = 4;   // columns / rows of plain track kept of a long stretch
function makeLineDraft(data) {
	const tiles = new Map();   // "x,y" -> { p, r, halt, s } (heights are not drawn: a bridge over a track is one tile)
	for (const t of data?.tiles || []) {
		const k = t.p[0] + "," + t.p[1];
		const o = tiles.get(k);
		if (o) { o.r |= t.r; o.halt = o.halt || t.halt; o.s = o.s || t.s; }
		else tiles.set(k, { p: t.p, r: t.r, halt: t.halt || "", s: t.s || null });
	}
	if (!tiles.size) return [];
	const at = (x, y) => tiles.get(x + "," + y);
	const nb = (t, d) => { const n = at(t.p[0] + DXY[d][0], t.p[1] + DXY[d][1]); return n && (n.r & BACK[d]) ? n : null; };
	const links = (t) => DIRS.filter(d => (t.r & d) && nb(t, d));
	// 1. chains of track between nodes (junctions, ends, the edges of stations). Signals do not cut a chain: a
	// diagonal with signals on it is still one straight line (the blocks are drawn along it)
	const node = (t) => { const l = links(t); return l.length !== 2 || l.some(d => !!nb(t, d).halt !== !!t.halt); };
	const seen = new Set();
	const edgeKey = (t, d) => t.p[0] + "," + t.p[1] + "|" + d;
	function chainFrom(t, d) {
		const chain = [t];
		seen.add(edgeKey(t, d));
		let cur = t, dir = d;
		for (let n = 0; n < 100000; n++) {
			const next = nb(cur, dir);
			seen.add(edgeKey(next, BACK[dir]));
			chain.push(next);
			if (node(next) || next === t) break;
			const out = links(next).find(x => x !== BACK[dir]);
			if (out === undefined) break;
			seen.add(edgeKey(next, out));
			cur = next; dir = out;
		}
		return chain;
	}
	const chains = [];
	for (const t of tiles.values()) if (node(t)) for (const d of links(t)) if (!seen.has(edgeKey(t, d))) chains.push(chainFrom(t, d));
	for (const t of tiles.values()) for (const d of links(t)) if (!seen.has(edgeKey(t, d))) chains.push(chainFrom(t, d));   // a loop without any node
	// 2. shorten: a column can go where all its tiles lie on plain chains going east-west or diagonally (a row: north-
	// south or diagonally), keeping a few of a long stretch; a column with a north-south chain in it stays (two
	// tracks side by side would fall onto one another)
	const lie = new Map();   // tile -> "h" | "v" | "d" (plain track of a chain going that way)
	for (const c of chains) for (let i = 1; i < c.length - 1; i++) {
		if (c[i].halt) continue;
		// the way the track goes here: over a few tiles before and after
		const a = c[Math.max(0, i - 4)], z = c[Math.min(c.length - 1, i + 4)];
		const dx = Math.abs(z.p[0] - a.p[0]), dy = Math.abs(z.p[1] - a.p[1]);
		const o = dx > 2 * dy ? "h" : dy > 2 * dx ? "v" : "d";
		lie.set(c[i], lie.has(c[i]) && lie.get(c[i]) !== o ? "x" : o);
	}
	const xs = [...tiles.values()].map(t => t.p[0]), ys = [...tiles.values()].map(t => t.p[1]);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
	function squeeze(lo, hi, cells, ok) {
		const map = new Map();
		let c = 0, run = 0;
		for (let v = lo; v <= hi; v++) {
			const cs = cells(v);
			const removable = cs.every(t => ok.includes(lie.get(t)));
			run = removable ? run + 1 : 0;
			// a gap without any track keeps one column, plain track a few; where a diagonal goes through, one column
			// in three stays (its slope stays the same in both ways)
			const keep = removable ? (cs.length ? LINE_KEEP : 1) : Infinity;
			if (run <= keep || (cs.some(t => lie.get(t) === "d") && run % 3 === 0)) c++;
			map.set(v, c - 1);
		}
		return map;
	}
	const byX = new Map(), byY = new Map();
	for (const t of tiles.values()) {
		if (!byX.has(t.p[0])) byX.set(t.p[0], []);
		if (!byY.has(t.p[1])) byY.set(t.p[1], []);
		byX.get(t.p[0]).push(t); byY.get(t.p[1]).push(t);
	}
	const cx = squeeze(x0, x1, v => byX.get(v) || [], ["h", "d"]), cy = squeeze(y0, y1, v => byY.get(v) || [], ["v", "d"]);
	const G = (t) => [2 * cx.get(t.p[0]) + 1, 2 * cy.get(t.p[1]) + 1];
	// 3. each chain: one line, or a few straight lines where it bends (stairs of a diagonal, whose corners are 1.4 steps off and up to a tile off where it was shortened, and gentle curves: within 2.2 steps)
	const parts = [];
	for (const chain of chains) {
		const pts = chain.map(G);
		const keep = [0];
		for (let i = 1; i < pts.length; i++) {
			const a = pts[keep[keep.length - 1]];
			const ok = (j) => {
				const b = pts[j], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
				for (let m = keep[keep.length - 1] + 1; m < j; m++) {
					const q = pts[m];
					if (Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / len > 2.2) return false;
				}
				return true;
			};
			if (i === pts.length - 1 || !ok(i + 1)) keep.push(i);
		}
		for (let k = 1; k < keep.length; k++) {
			const a = pts[keep[k - 1]], b = pts[keep[k]];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			parts.push({ t: "T", x1: a[0], y1: a[1], x2: b[0], y2: b[1], b: chain.slice(keep[k - 1], keep[k] + 1).map(t => t.p), s: "", f: 0 });
		}
	}
	// 4. stations: the platform tiles of each stop, its platform tracks (tiles of the stop joined by track)
	const stops = new Map();
	for (const t of tiles.values()) if (t.halt) { if (!stops.has(t.halt)) stops.set(t.halt, []); stops.get(t.halt).push(t); }
	const boxes = [];   // rectangles taken (windows and names must not cover them)
	const take = (r) => boxes.push(r);
	const free = (r) => !boxes.some(b => r.x1 < b.x2 + 1 && r.x2 > b.x1 - 1 && r.y1 < b.y2 + 1 && r.y2 > b.y1 - 1);
	for (const [name, ts] of stops) {
		const tracks = [], done = new Set();
		for (const t of ts) {
			if (done.has(t)) continue;
			const comp = [t];
			done.add(t);
			for (let i = 0; i < comp.length; i++) for (const d of links(comp[i])) {
				const n = nb(comp[i], d);
				if (n.halt === name && !done.has(n)) { done.add(n); comp.push(n); }
			}
			tracks.push(comp);
		}
		const all = ts.map(G);
		const sx1 = Math.min(...all.map(g => g[0])), sx2 = Math.max(...all.map(g => g[0])), sy1 = Math.min(...all.map(g => g[1])), sy2 = Math.max(...all.map(g => g[1]));
		// a station with points near it (or with more than two tracks) gets number boxes on its tracks
		const big = tracks.length > 2 || [...tiles.values()].some(t => links(t).length > 2 && Math.abs(t.p[0] - ts[0].p[0]) + Math.abs(t.p[1] - ts[0].p[1]) <= 12 &&
			ts.some(s => Math.abs(t.p[0] - s.p[0]) <= 6 && Math.abs(t.p[1] - s.p[1]) <= 6));
		const mid = (sy1 + sy2) / 2;
		if (big) {
			for (const comp of tracks) {
				const g = comp.map(G);
				const gx1 = Math.min(...g.map(v => v[0])), gx2 = Math.max(...g.map(v => v[0])), gy1 = Math.min(...g.map(v => v[1])), gy2 = Math.max(...g.map(v => v[1]));
				const box = gy1 === gy2 ? { x1: gx1 - 1, y1: gy1 - 1, x2: Math.max(gx2 + 1, gx1 + 5), y2: gy1 + 1 } : { x1: gx1 - 1, y1: gy1 - 1, x2: gx2 + 1, y2: gy2 + 1 };
				// the delay box above the upper tracks, below the others
				const below = tracks.length > 1 && gy1 >= mid ? 1 : 0;
				parts.push(Object.assign({ t: "B", b: comp.map(t => t.p), s: encodeURIComponent(name), f: below }, box));
				take({ x1: box.x1, x2: box.x2, y1: below ? box.y1 : box.y1 - 3, y2: below ? box.y2 + 3 : box.y2 });
			}
		}
		else {
			// between its tracks (or beside the one track): the platform
			const h = sy1 === sy2 ? { x1: sx1 - 1, y1: sy1 - 2, x2: Math.max(sx2 + 1, sx1 + 2), y2: sy1 - 1 } : { x1: sx1 - 1, y1: Math.round(mid) - 1, x2: Math.max(sx2 + 1, sx1 + 2), y2: Math.round(mid) + 1 };
			parts.push(Object.assign({ t: "H", b: ts.map(t => t.p), s: encodeURIComponent(name), f: 0 }, h));
			take(h);
		}
	}
	// the station names above their stations (where nothing else is)
	placeLineNames(parts, boxes);
	// 5. train number windows: on the long straight lines between stations, one for each block (between signals) of
	// the line; above an upper track or beside a north-south one, below a lower one
	const isSig = (q) => !!tiles.get(q[0] + "," + q[1])?.s;
	const lines = parts.filter(p => p.t === "T" && (p.y1 === p.y2 || p.x1 === p.x2) && Math.abs(p.x2 - p.x1) + Math.abs(p.y2 - p.y1) >= 8 && !p.b.some(q => tiles.get(q[0] + "," + q[1])?.halt));
	for (const p of lines) {
		const flat = p.y1 === p.y2;
		const lo = flat ? Math.min(p.x1, p.x2) : Math.min(p.y1, p.y2), hi = flat ? Math.max(p.x1, p.x2) : Math.max(p.y1, p.y2), pos = flat ? p.y1 : p.x1;
		const parallel = (d) => parts.some(q => q.t === "T" && q !== p && (flat ? q.y1 === q.y2 && q.y1 - pos === d && Math.min(q.x1, q.x2) < hi && Math.max(q.x1, q.x2) > lo
			: q.x1 === q.x2 && q.x1 - pos === d && Math.min(q.y1, q.y2) < hi && Math.max(q.y1, q.y2) > lo));
		const up = [1, 2, 3, 4, 5, 6].some(d => parallel(-d)), down = [1, 2, 3, 4, 5, 6].some(d => parallel(d));
		// a track between two others (the throat of a station): no room for a window
		if (up && down) continue;
		// the blocks along the line: runs of tiles between signal tiles
		const runs = [];
		let cur = [];
		p.b.forEach((q, i) => { if (isSig(q)) { if (cur.length) runs.push(cur); cur = []; } else cur.push(i); });
		if (cur.length) runs.push(cur);
		for (const run of runs) {
			const f = (run[0] + run[run.length - 1]) / 2 / Math.max(1, p.b.length - 1);
			const mx = Math.round(p.x1 + (p.x2 - p.x1) * f), my = Math.round(p.y1 + (p.y2 - p.y1) * f);
			const w = 6;
			const r = flat ? (up ? { x1: mx - w / 2, y1: pos + 1, x2: mx + w / 2, y2: pos + 3 } : { x1: mx - w / 2, y1: pos - 3, x2: mx + w / 2, y2: pos - 1 })
				: (up ? { x1: pos + 1, y1: my - 1, x2: pos + 1 + w, y2: my + 1 } : { x1: pos - 1 - w, y1: my - 1, x2: pos - 1, y2: my + 1 });
			if (!free(r)) continue;
			take(r);
			// its direction: of the signal at either end of the block (only one way)
			const ends = [p.b[run[0] - 1], p.b[run[run.length - 1] + 1]].filter(Boolean).map(q => tiles.get(q[0] + "," + q[1])?.s).filter(s => s && [N, E, S, W].includes(s.dir));
			parts.push(Object.assign({ t: "W", b: run.map(i => p.b[i]), s: "", f: ends.length ? ends[0].dir : 0, ty: (flat ? "h" : "v") + pos }, r));
		}
	}
	// a window of a block without a signal: the direction of the nearest window on the same track
	const wins = parts.filter(p => p.t === "W");
	for (const w of wins) if (!w.f) {
		const near = wins.filter(o => o.f && o.ty === w.ty).sort((a, b) => Math.abs(a.x1 + a.y1 - w.x1 - w.y1) - Math.abs(b.x1 + b.y1 - w.x1 - w.y1))[0];
		if (near) w.f = near.f;
	}
	for (const w of wins) delete w.ty;
	// 6. the clock at the top left; everything starts at (2,2)
	const minX = Math.min(...parts.flatMap(p => [p.x1, p.x2])), minY = Math.min(...parts.flatMap(p => [p.y1, p.y2]));
	parts.push({ t: "C", x1: minX + 5, y1: minY - 4, x2: minX + 5, y2: minY - 4, b: [], s: "", f: 0 });
	return normalizeLine(parts);
}
// the whole drawing moved to start at the top left (whole steps)
function normalizeLine(parts) {
	const placed = parts.filter(p => p.t !== "Y");
	if (!placed.length) return parts;
	const ox = 7 - Math.min(...placed.flatMap(p => [p.x1, p.x2])), oy = 4 - Math.min(...placed.flatMap(p => [p.y1, p.y2]));
	for (const p of placed) { p.x1 = Math.round(p.x1 + ox); p.x2 = Math.round(p.x2 + ox); p.y1 = Math.round(p.y1 + oy); p.y2 = Math.round(p.y2 + oy); }
	return parts;
}
// station names (N) above their stations: the boxes (B) and platforms (H) of the same name; moved further up (then down)
// where another name, box or track is in the way. Used by the draft and after turning the drawing
function placeLineNames(parts, boxes = null) {
	const taken = boxes || parts.filter(p => "BHW".includes(p.t)).map(p => ({ x1: Math.min(p.x1, p.x2), x2: Math.max(p.x1, p.x2), y1: Math.min(p.y1, p.y2) - (p.t === "B" ? 3 : 0), y2: Math.max(p.y1, p.y2) }));
	const free = (r) => !taken.some(b => r.x1 < b.x2 + 1 && r.x2 > b.x1 - 1 && r.y1 < b.y2 + 1 && r.y2 > b.y1 - 1);
	const onTrack = (r) => parts.some(q => q.t === "T" && Math.min(q.x1, q.x2) <= r.x2 && Math.max(q.x1, q.x2) >= r.x1 && Math.min(q.y1, q.y2) <= r.y2 && Math.max(q.y1, q.y2) >= r.y1);
	const stations = new Map();
	for (const p of parts) if ((p.t === "B" || p.t === "H") && p.s) { if (!stations.has(p.s)) stations.set(p.s, []); stations.get(p.s).push(p); }
	for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t === "N" && stations.has(parts[i].s)) parts.splice(i, 1);
	for (const [s, ps] of stations) {
		const small = ps.every(p => p.t === "H");
		const name = lineText({ s });
		const x1 = Math.min(...ps.flatMap(p => [p.x1, p.x2])), x2 = Math.max(...ps.flatMap(p => [p.x1, p.x2])), y1 = Math.min(...ps.flatMap(p => [p.y1, p.y2]));
		const cxm = Math.round((x1 + x2) / 2), y = y1 - (small ? 2 : 4);
		const half = (name.length * (small ? .75 : 1.1) + 1) / 2;
		const box = (yy) => ({ x1: cxm - half, x2: cxm + half, y1: yy - 1.5, y2: yy + 1.5 });
		const tries = [0, -3, -6, -9, -12, -15, -18, -21, 3, 6, 9, 12].map(d => y + d);
		const yy = tries.find(v => free(box(v)) && !onTrack(box(v))) ?? tries.find(v => free(box(v))) ?? y;
		parts.push({ t: "N", x1: cxm, y1: yy, x2: cxm, y2: yy, b: [], s, f: small ? 1 : 0 });
		taken.push(box(yy));
	}
	return parts;
}
// the drawing turned a quarter clockwise; windows stay lying, station names stay upright and go above their stations again
function rotateLine(parts) {
	const placed = parts.filter(p => p.t !== "Y");
	const H = Math.max(...placed.flatMap(p => [p.y1, p.y2]));
	for (const p of placed) {
		if (p.t === "W") {
			const cxm = (p.x1 + p.x2) / 2, cym = (p.y1 + p.y2) / 2, w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
			const nx = H - cym, ny = cxm;
			Object.assign(p, { x1: nx - w / 2, x2: nx + w / 2, y1: ny - h / 2, y2: ny + h / 2 });
			continue;
		}
		const a = [H - p.y1, p.x1], b = [H - p.y2, p.x2];
		if ("BHF".includes(p.t)) Object.assign(p, { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) });
		else Object.assign(p, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
	}
	placeLineNames(parts);
	return normalizeLine(parts);
}

// ---------------------------------------------------------------------------
// what moves on a line panel: occupied blocks, train numbers, routes
// ---------------------------------------------------------------------------
const key3 = (p) => p[0] + "," + p[1] + "," + p[2];
// blocks: the track divided at the signals and the points (a signal or a point tile is a block of its own), like the
// track circuits of the TID: a train in the throat of a station shows on its own track only, not on the tracks the
// points lead to. Worked out once per set of tiles
let lineBlockCache = null;   // { tiles, map: "x,y,z" -> block }
function lineBlocks(tiles) {
	if (lineBlockCache && lineBlockCache.tiles === tiles) return lineBlockCache.map;
	const byXY = new Map();
	for (const t of tiles) { const k = t.p[0] + "," + t.p[1]; if (!byXY.has(k)) byXY.set(k, []); byXY.get(k).push(t); }
	const up = new Map(tiles.map(t => [key3(t.p), key3(t.p)]));
	const find = (k) => { while (up.get(k) !== k) { up.set(k, up.get(up.get(k))); k = up.get(k); } return k; };
	const cut = (t) => !!t.s || DIRS.filter(d => t.r & d).length > 2;
	for (const t of tiles) {
		if (cut(t)) continue;
		for (const d of DIRS) {
			if (!(t.r & d)) continue;
			// the next tile (one level up or down on a slope)
			const n = (byXY.get((t.p[0] + DXY[d][0]) + "," + (t.p[1] + DXY[d][1])) || []).find(o => (o.r & BACK[d]) && Math.abs(o.p[2] - t.p[2]) <= 1);
			if (n && !cut(n)) up.set(find(key3(t.p)), find(key3(n.p)));
		}
	}
	const map = new Map();
	for (const t of tiles) map.set(key3(t.p), find(key3(t.p)));
	lineBlockCache = { tiles, map };
	return map;
}
// the blocks a line (or a window bound to a line) stands for: those of its tiles inside (its ends are junctions,
// signals or the edge of a station, which belong to the next line as well)
const innerTiles = (p) => (p.b || []).length > 2 ? p.b.slice(1, -1) : (p.b || []);
// train number (as matched with the diagram, else the operation number of the game) and delay in whole minutes
function lineTrainLabel(c, data) {
	const id = identifyTrain(c, data);
	// the train number: given by hand or of the diagram; else the schedule's name; else the operation number
	const number = id.tag?.number || id.one?.number || c.line || id.op;
	return { convoy: c, number, text: lineLabelMode === "line" ? (c.line || id.op) : lineLabelMode === "name" ? c.name : number, op: id.op, red: id.red, cars: c.cars || 0, type: id.one?.type || "", destination: id.one ? id.one.stops[id.one.to]?.name || id.one.destination : "",
		entry: id.one, delay: id.delay, minutes: id.delay.seconds >= 60 ? Math.floor(id.delay.seconds / 60) : 0 };
}

// colours of the train numbers: rules of the line panel, kept in its style part (Y) as encoded JSON:
// [{ k: "cars" | "type" | "number" | "op", v: value (cars: a number; the others: a regular expression), c: colour }].
// The first rule that fits wins; a train marked by hand (special train number) is red
const LINE_NUMBER_COLOR = "#ffb31a", LINE_SPECIAL_COLOR = "#ff4040";
function lineRules(parts) {
	const y = (parts || []).find(p => p.t === "Y");
	try { const r = JSON.parse(decodeURIComponent(y?.s || "")); return Array.isArray(r?.rules) ? r.rules : []; } catch (e) { return []; }
}
function lineNumberColor(rules, t) {
	if (t.red) return LINE_SPECIAL_COLOR;
	const fits = (r) => {
		if (r.k === "cars") return Number(r.v) === t.cars;
		const text = r.k === "type" ? t.type : r.k === "op" ? t.op : t.number;
		try { return new RegExp(r.v).test(text || ""); } catch (e) { return false; }
	};
	return (rules.find(r => r && r.c && fits(r)) || {}).c || LINE_NUMBER_COLOR;
}
// where each train is shown: the number box of the platform it stands at, else the window of its block that
// shows its direction. part index -> label
function lineTrainPlaces(parts, data, label = lineTrainLabel) {
	const places = new Map();
	if (!data?.convoys?.length || !data.tiles) return places;
	const blocks = lineBlocks(data.tiles);
	const winBlocks = parts.map(p => p.t === "W" ? new Set(innerTiles(p).map(t => blocks.get(key3(t))).filter(Boolean)) : null);
	const boxTiles = parts.map(p => p.t === "B" ? new Set((p.b || []).map(key3)) : null);
	for (const c of data.convoys) {
		const occ = [key3(c.pos)].concat(c.occupied.map(key3).filter(k => k !== key3(c.pos)));
		let at = -1;
		for (const k of occ) { at = boxTiles.findIndex((b, i) => b && b.has(k) && !places.has(i)); if (at >= 0) break; }
		if (at < 0) for (const k of occ) {
			const bk = blocks.get(k);
			at = winBlocks.findIndex((b, i) => b && b.has(bk) && !places.has(i) && (!parts[i].f || (parts[i].f & c.dir)));
			if (at >= 0) break;
		}
		if (at >= 0) places.set(at, label(c, data));
	}
	return places;
}
// lines red where a block of theirs has a train; the parts of lines that routes of the panel take
// the stretches of the lines whose blocks have a train: [x1, y1, x2, y2] on the panel
function lineOccupied(parts, data) {
	const spans = [];
	if (!data?.tiles) return spans;
	const blocks = lineBlocks(data.tiles);
	const taken = new Set((data.convoys || []).flatMap(c => c.occupied.map(p => blocks.get(key3(p)))));
	if (!taken.size) return spans;
	for (const p of parts) {
		if (p.t !== "T" || !p.b?.length) continue;
		const n = p.b.length - 1, on = p.b.map(t => taken.has(blocks.get(key3(t))));
		// the point at an end of a line: red with the line only (a train on the point is not on every track it leads to)
		if (n > 0 && on[0] && !on[1]) on[0] = false;
		if (n > 0 && on[n] && !on[n - 1]) on[n] = false;
		for (let i = 0; i <= n; i++) {
			if (!on[i]) continue;
			let j = i;
			while (j < n && on[j + 1]) j++;
			const f1 = n ? Math.max(0, (i - .5) / n) : 0, f2 = n ? Math.min(1, (j + .5) / n) : 1;
			spans.push([p.x1 + (p.x2 - p.x1) * f1, p.y1 + (p.y2 - p.y1) * f1, p.x1 + (p.x2 - p.x1) * f2, p.y1 + (p.y2 - p.y1) * f2]);
			i = j;
		}
	}
	return spans;
}
function lineRouteSpans(parts) {
	const tiles = new Set((status.routes || []).filter(r => r.state !== "idle").flatMap(r => r.tiles.map(key3)));
	const spans = [];
	if (!tiles.size) return spans;
	for (const p of parts) {
		if (p.t !== "T" || !p.b?.length) continue;
		const idx = p.b.map((t, i) => tiles.has(key3(t)) ? i : -1).filter(i => i >= 0);
		if (idx.length < 2 && !(idx.length === 1 && p.b.length === 1)) continue;
		const n = Math.max(1, p.b.length - 1), f1 = idx[0] / n, f2 = idx[idx.length - 1] / n;
		spans.push([p.x1 + (p.x2 - p.x1) * f1, p.y1 + (p.y2 - p.y1) * f1, p.x1 + (p.x2 - p.x1) * f2, p.y1 + (p.y2 - p.y1) * f2]);
	}
	return spans;
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------
const lineText = (p) => { try { return decodeURIComponent(p.s || ""); } catch (e) { return p.s || ""; } };
// a number for each set of parts drawn (a new set: drawn anew)
const lineDrawn = new WeakMap();
let lineDrawnNext = 1;
function renderLineMap(svg, wrap, parts, data) {
	if (!lineDrawn.has(parts)) lineDrawn.set(parts, lineDrawnNext++);
	const placed = parts.filter(p => p.t !== "Y");
	// a station name reaches beyond its point: about its number of characters times its size (in steps)
	const reach = (p) => p.t === "N" ? (lineText(p).length * (p.f & 1 ? .75 : 1.1) + 1) : p.t === "C" ? 4 : 0;
	const GW = Math.max(20, Math.max(...placed.flatMap(p => [p.x1 + reach(p), p.x2 + reach(p)]), 0) + 4), GH = Math.max(12, Math.max(...placed.flatMap(p => [p.y1, p.y2]), 0) + 6);
	const fit = Math.min((wrap.clientWidth - 24) / GW, (wrap.clientHeight - 24) / GH);
	const G = Math.max(3, Math.min(40, (fit || 10) * networkMapZoom));   // pixels per grid step
	// the blue fills the frame even when the drawing is smaller
	const SW = Math.max(GW * G, wrap.clientWidth - 2), SH = Math.max(GH * G, wrap.clientHeight - 2);
	const redLines = lnEdit ? [] : lineOccupied(parts, data);
	const places = lnEdit ? new Map() : lineTrainPlaces(parts, data);
	const rules = lineRules(parts);
	const spans = lnEdit ? [] : lineRouteSpans(parts);
	// nothing changed but the time (not editing): only the clock is written again. A drawing made anew every
	// time lost clicks on it and cost the browser for nothing
	const sig = lnEdit ? null : JSON.stringify([lineDrawn.get(parts), SW, SH, G, redLines, [...places].map(([i, t]) => [i, t.text, t.minutes, lineNumberColor(rules, t)]), spans]);
	if (sig && sig === svg.dataset.sig) {
		for (const t of svg.querySelectorAll(".lnclock")) t.textContent = data?.time || clockOf(status).hms;
		return;
	}
	svg.dataset.sig = sig || "";
	svg.setAttribute("viewBox", `0 0 ${SW} ${SH}`);
	svg.setAttribute("width", SW);
	svg.setAttribute("height", SH);
	svg.replaceChildren();
	el("rect", { x: 0, y: 0, width: SW, height: SH, fill: "url(#lineBg)" }, svg);
	const defs = el("defs", {}, svg);
	const gr = el("linearGradient", { id: "lineBg", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
	el("stop", { offset: "0", "stop-color": "#1047e0" }, gr);
	el("stop", { offset: "1", "stop-color": "#0a2fb0" }, gr);
	const X = (v) => v * G, Y = (v) => v * G;
	if (lnEdit) {
		const dots = el("g", { "pointer-events": "none" }, svg);
		for (let x = 0; x <= GW; x += 2) for (let y = 0; y <= GH; y += 2) el("circle", { cx: X(x), cy: Y(y), r: 1, fill: "#5f86ff" }, dots);
	}
	// a number written in a box: as large as fits
	const digits = (grp, text, x, y, w, h, color) => {
		const fs = Math.max(6, Math.min(h * .8, w / Math.max(2, String(text).length * .62)));
		el("text", { x, y: y + h / 2, "font-size": fs, "font-family": "'DejaVu Sans Mono', Consolas, monospace", "font-weight": 700, fill: color, "text-anchor": "middle", "dominant-baseline": "central" }, grp).textContent = text;
	};
	const order = { F: 0, H: 1, T: 2, W: 3, B: 4, N: 5, L: 5, C: 5, Y: -1 };
	const idx = parts.map((p, i) => i).sort((a, b) => (order[parts[a].t] ?? 5) - (order[parts[b].t] ?? 5));
	const rect = (p) => ({ x: X(Math.min(p.x1, p.x2)), y: Y(Math.min(p.y1, p.y2)), width: Math.max(2, Math.abs(X(p.x2 - p.x1))), height: Math.max(2, Math.abs(Y(p.y2 - p.y1))) });
	for (const i of idx) {
		const p = parts[i];
		if (p.t === "Y") continue;
		const grp = el("g", { class: (lnEdit ? "lnpart" : "") + (lnEdit && (lnEdit.sel === i || lnEdit.multi?.has(i)) ? " sel" : ""), "data-lnpart": i }, svg);
		if (p.t === "T") {
			const color = "#eef3ff";
			el("line", { x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), stroke: color, "stroke-width": Math.max(2, G * .32), "stroke-linecap": "square" }, grp);
			// the small marks across the track, as on the TID
			el("line", { x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), stroke: color, "stroke-width": Math.max(4, G * .7), "stroke-dasharray": `1 ${Math.max(4, G * 1.2)}`, opacity: .8 }, grp);
			if (lnEdit) el("line", { x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), stroke: "transparent", "stroke-width": 14 }, grp);
		}
		else if (p.t === "W" || p.t === "B") {
			const r = rect(p);
			el("rect", Object.assign({ fill: "#0b2c99", stroke: "#5d82ff", "stroke-width": 1.2 }, r), grp);
			const train = places.get(i);
			const color = train ? lineNumberColor(rules, train) : null;
			if (train) {
				grp.style.cursor = "pointer";
				grp.addEventListener("click", (e) => { e.stopPropagation(); openTrainDetail(train); });
			}
			if (p.t === "W") {
				// the train number and, at the right, the delay in minutes
				const dx = r.x + r.width - Math.min(r.width / 3, G * 1.6);
				el("line", { x1: dx, y1: r.y, x2: dx, y2: r.y + r.height, stroke: "#5d82ff", "stroke-width": 1 }, grp);
				if (train) {
					grp.setAttribute("class", (grp.getAttribute("class") || "") + " train");
					digits(grp, train.text, r.x + (dx - r.x) / 2, r.y, dx - r.x - 2, r.height, color);
					if (train.minutes) digits(grp, train.minutes, dx + (r.x + r.width - dx) / 2, r.y, r.x + r.width - dx - 2, r.height, "#ff4040");
				}
			}
			else {
				const s = G * 1.6, cxm = r.x + r.width / 2, sy = p.f & 1 ? r.y + r.height + G * .6 : r.y - G * .6 - s;
				el("rect", { x: cxm - s / 2, y: sy, width: s, height: s, fill: "#0b2c99", stroke: "#5d82ff", "stroke-width": 1.2 }, grp);
				if (train) {
					grp.setAttribute("class", (grp.getAttribute("class") || "") + " train");
					digits(grp, train.text, cxm, r.y, r.width - 4, r.height, color);
					if (train.minutes) digits(grp, train.minutes, cxm, sy, s - 2, s, "#ff4040");
				}
			}
		}
		else if (p.t === "H") el("rect", Object.assign({ fill: "#38c8ff" }, rect(p)), grp).appendChild(el("title", {})).textContent = lineText(p);
		else if (p.t === "N") {
			const small = p.f & 1, fs = Math.max(8, small ? G * .9 : G * 1.3);
			const t = el("text", { x: X(p.x1), y: Y(p.y1), "font-size": fs, fill: small ? "#d6e2ff" : "#ffffff", "text-anchor": "middle", "dominant-baseline": "middle", "letter-spacing": small ? 0 : fs * .12 }, grp);
			t.textContent = lineText(p) || "（駅名）";
			if (!small) {
				// the frame around the name: as wide as the text drawn
				let w = 0;
				try { w = t.getComputedTextLength(); } catch (e) {}
				w = (w || t.textContent.length * fs * .8) + fs * .6;
				el("rect", { x: X(p.x1) - w / 2, y: Y(p.y1) - fs * .7, width: w, height: fs * 1.4, fill: "none", stroke: "#aac0ff", "stroke-width": 1.2 }, grp);
			}
		}
		else if (p.t === "L") el("text", { x: X(p.x1), y: Y(p.y1), "font-size": Math.max(8, G * 1.2), fill: "#ffffff", "text-anchor": "middle", "dominant-baseline": "middle" }, grp).textContent = lineText(p) || "（文字）";
		else if (p.t === "F") el("rect", Object.assign({ fill: "none", stroke: "#9db4ff", "stroke-width": 1.2, "stroke-dasharray": "6 4" }, rect(p)), grp);
		else if (p.t === "C") el("text", { x: X(p.x1), y: Y(p.y1), "font-size": Math.max(9, G * 1.3), fill: "#ffffff", "font-family": "monospace", "text-anchor": "middle", "dominant-baseline": "middle", class: "lnclock" }, grp).textContent = data?.time || clockOf(status).hms;
	}
	// the blocks with a train, and the routes set on the panels of the stations (red, over the tracks)
	for (const [ax, ay, bx, by] of redLines) {
		const og = el("g", { class: "lnoccupied", "pointer-events": "none" }, svg);
		el("line", { x1: X(ax), y1: Y(ay), x2: X(bx), y2: Y(by), stroke: "#ff3b30", "stroke-width": Math.max(2, G * .32), "stroke-linecap": "butt" }, og);
		el("line", { x1: X(ax), y1: Y(ay), x2: X(bx), y2: Y(by), stroke: "#ff3b30", "stroke-width": Math.max(4, G * .7), "stroke-dasharray": `1 ${Math.max(4, G * 1.2)}`, opacity: .8 }, og);
	}
	if (!lnEdit) for (const [ax, ay, bx, by] of spans)
		el("line", { x1: X(ax), y1: Y(ay), x2: X(bx), y2: Y(by), stroke: "#ff3b30", "stroke-width": Math.max(2, G * .32), "stroke-linecap": "square", class: "lnroute", "pointer-events": "none" }, svg);
	if (lnEdit && parts[lnEdit.sel] && "TWBHF".includes(parts[lnEdit.sel].t)) {
		const p = parts[lnEdit.sel];
		for (const [x, y, h] of [[p.x1, p.y1, 1], [p.x2, p.y2, 2]]) el("rect", { x: X(x) - 5, y: Y(y) - 5, width: 10, height: 10, fill: "#ffe066", stroke: "#000", class: "lnhandle", "data-h": h }, svg);
	}
	if (lnEdit && lnEdit.rubber) {
		const r = lnEdit.rubber;
		el("rect", { x: X(Math.min(r.from[0], r.to[0])), y: Y(Math.min(r.from[1], r.to[1])), width: Math.abs(X(r.to[0] - r.from[0])), height: Math.abs(Y(r.to[1] - r.from[1])), fill: "rgba(255,224,102,.12)", stroke: "#ffe066", "stroke-dasharray": "6 4", "pointer-events": "none" }, svg);
	}
	if (lnEdit && lnEdit.drawing) {
		const d = lnEdit.drawing;
		el("line", { x1: X(d.from[0]), y1: Y(d.from[1]), x2: X(d.to[0]), y2: Y(d.to[1]), stroke: "#ffe066", "stroke-width": 4, "stroke-dasharray": "8 6", "pointer-events": "none" }, svg);
	}
	if (lnEdit) bindLineEditor(svg, G);
	else svg.onmousedown = svg.onmousemove = svg.onmouseup = svg.ondblclick = null;
}

// the parts drawn now (for tests and tools)
function lnPartsShown() { return lnEdit ? lnEdit.parts : lineParts(shownLine()) || []; }
// the line panel or the map, and the bar above them; called from renderNetwork()
function renderLine(data) {
	const bar = document.getElementById("lineBar"), wrap = document.getElementById("lineWrap"), mapWrap = document.getElementById("networkMapWrap");
	if (!bar || !wrap) return;
	if (lineView !== "map" && !shownLine() && !lnEdit) lineView = "map";
	const ln = lnEdit ? linesOf().find(x => x.id === lnEdit.id) : shownLine();
	const html = lineBarHtml(ln);
	if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
	const onLine = !!(lnEdit || ln);
	wrap.hidden = !onLine;
	mapWrap.hidden = onLine;
	if (!onLine) return;
	const parts = lnEdit ? lnEdit.parts : lineParts(ln);
	const svg = document.getElementById("lineMap");
	if (!parts) { svg.replaceChildren(); svg.dataset.sig = ""; return; }
	renderLineMap(svg, wrap, parts, data);
}

function lineBarHtml(ln) {
	if (lnEdit) {
		const sel = lnEdit.parts[lnEdit.sel];
		const tool = (t, label, title) => `<button data-ln="tool" data-t="${t}" class="${lnEdit.tool === t ? "on" : ""}" title="${title}">${label}</button>`;
		return `<span class="cpedit">路線盤「${esc(ln ? lineName(ln) : "")}」を編集中</span>` +
			tool("T", "＋線路", "押してから盤の上をドラッグして線を引く。両端が線路の上なら、その間の線路に結びつく") +
			tool("W", "＋列番窓", "押してから盤の空いた所を押す。近くの線路に結びつく") +
			tool("B", "＋番線枠", "押してから番線の線路の上を押す") + tool("H", "＋ホーム", "押してから駅の線路の近くを押す") +
			tool("N", "＋駅名", "押してから盤の空いた所を押す") + tool("L", "＋文字", "押してから盤の空いた所を押す") +
			`<button data-ln="clock">時計</button><button data-ln="colors" title="列番の色の決め方（両数・種別・列番・運用番号ごと）">色分け</button><span class="sep"></span>` +
			(sel && sel.t === "B" ? `<button data-ln="flip" title="遅延表示の箱を上下入れ替える">遅延の箱を${sel.f & 1 ? "上" : "下"}へ</button>` : "") +
			(sel && sel.t === "N" ? `<button data-ln="small" title="大きな駅名（枠つき）と小さな駅名を切り替える">${sel.f & 1 ? "大きな駅名に" : "小さな駅名に"}</button>` : "") +
			tool("R", "範囲で選ぶ", "押してから盤の上をドラッグして囲む。囲んだ部品をまとめて消す（Delete）・動かす（ドラッグ、矢印キー）") +
			`<button data-ln="rotate" title="図を右へ 90° 回す（駅名は駅の上に置き直す）">回転</button>` +
			`<button data-ln="del" ${sel || lnEdit.multi?.size ? "" : "disabled"} title="選んだ部品を消す（Delete キー）">削除${lnEdit.multi?.size ? `（${lnEdit.multi.size}個）` : ""}</button>` +
			`<button data-ln="undo" ${lnEdit.undo.length ? "" : "disabled"} title="元に戻す（Ctrl+Z）">↶ 戻す</button><button data-ln="redo" ${lnEdit.redo.length ? "" : "disabled"} title="やり直す（Ctrl+Y）">↷</button>` +
			`<button data-ln="draft" title="線路から下書きを作り直す（編集した内容は消えます）">下書きを作り直す</button>` +
			`<button data-ln="apply" class="primary" title="ゲームに保存して全員の盤に反映する">適用</button><button data-ln="cancel">やめる</button>`;
	}
	if (lnPick) return `<span class="cpedit">路線盤「${esc(lnPick.name)}」の範囲：地図の上をドラッグして囲んでください</span>` +
		`<button data-ln="pickall" title="今つながっている線路を全部使う">全部で作る</button><button data-ln="pickcancel">やめる</button>`;
	const tabs = `<select data-ln="label" title="窓に出すもの（このブラウザだけ）"><option value="number" ${lineLabelMode === "number" ? "selected" : ""}>列番表示</option><option value="line" ${lineLabelMode === "line" ? "selected" : ""}>スケジュール名表示</option><option value="name" ${lineLabelMode === "name" ? "selected" : ""}>編成名表示</option></select>` +
		`<button data-ln="view" data-id="map" class="${!ln ? "on" : ""}" title="ゲームの線路をそのまま描いた地図">地図</button>` +
		linesOf().map(x => `<button data-ln="view" data-id="${x.id}" class="${ln && ln.id === x.id ? "on" : ""}">${esc(lineName(x))}</button>`).join("");
	const tools = `<span class="sep"></span><button data-ln="new" title="今つながっている線路から下書きを作り、路線盤を作る">＋路線盤</button>` +
		(ln ? `<button data-ln="edit">盤を編集</button><button data-ln="rename">名前を変える</button><button data-ln="remove">削除</button>` +
			(ln.editing !== undefined ? `<span class="cpedit" title="後から「適用」した方の内容になります">✎ ${esc(companyName(ln.editing))}が編集中</span>` : "") : "");
	return tabs + tools;
}

// ---------------------------------------------------------------------------
// editor
// ---------------------------------------------------------------------------
function lnTrack() {
	if (!lnEdit || lnEdit.drag) return;
	const now = JSON.stringify(lnEdit.parts);
	if (now === lnEdit.last) return;
	lnEdit.undo.push(lnEdit.last);
	if (lnEdit.undo.length > 200) lnEdit.undo.shift();
	lnEdit.redo = [];
	lnEdit.last = now;
}
function lnUndo(redo = false) {
	if (!lnEdit) return;
	lnTrack();
	const from = redo ? lnEdit.redo : lnEdit.undo, to = redo ? lnEdit.undo : lnEdit.redo;
	if (!from.length) return;
	to.push(lnEdit.last);
	lnEdit.last = from.pop();
	lnEdit.parts = JSON.parse(lnEdit.last);
	lnEdit.sel = -1; lnEdit.dirty = true;
	renderNetwork();
}
// distance of a point of the grid from a line part
function distToLine(p, q) {
	const dx = p.x2 - p.x1, dy = p.y2 - p.y1, l2 = dx * dx + dy * dy;
	const f = l2 ? Math.max(0, Math.min(1, ((q[0] - p.x1) * dx + (q[1] - p.y1) * dy) / l2)) : 0;
	return Math.hypot(p.x1 + dx * f - q[0], p.y1 + dy * f - q[1]);
}
// the tiles a new window / box / platform stands for: those of the nearest line (a box or platform: its station tiles)
function nearTiles(parts, q, stationOnly) {
	let best = null, bd = 4;
	for (const p of parts) if (p.t === "T" && p.b?.length) { const d = distToLine(p, q); if (d < bd) { bd = d; best = p; } }
	if (!best) return [];
	if (!stationOnly) return best.b.slice();
	const halts = new Set((network?.tiles || []).filter(t => t.halt).map(t => t.p.join(",")));
	const own = best.b.filter(t => halts.has(t.join(",")));
	return own.length ? own : best.b.slice();
}
// the tiles of a line drawn from a to b: the track between the tiles of the lines nearest to its ends
function lineAutoBind(parts, a, b) {
	const near = (pt) => {
		let best = null, bd = 1.6;
		for (const p of parts) if (p.t === "T" && p.b?.length) p.b.forEach((t, k) => {
			const f = p.b.length > 1 ? k / (p.b.length - 1) : .5;
			const d = Math.hypot(p.x1 + (p.x2 - p.x1) * f - pt[0], p.y1 + (p.y2 - p.y1) * f - pt[1]);
			if (d < bd) { bd = d; best = t; }
		});
		return best;
	};
	const ta = near(a), tb = near(b);
	if (!ta || !tb) return [];
	if (ta.join(",") === tb.join(",")) return [ta];
	const index = new Map((network?.tiles || []).map(t => [t.p[0] + "," + t.p[1], t]));
	const k2 = (p) => p[0] + "," + p[1];
	const prev = new Map([[k2(ta), null]]), todo = [ta];
	for (let i = 0; i < todo.length && todo.length < 20000; i++) {
		const t = index.get(k2(todo[i]));
		if (!t || k2(t.p) === k2(tb)) break;
		for (const d of DIRS) {
			if (!(t.r & d)) continue;
			const n = index.get((t.p[0] + DXY[d][0]) + "," + (t.p[1] + DXY[d][1]));
			if (!n || prev.has(k2(n.p)) || !(n.r & BACK[d])) continue;
			prev.set(k2(n.p), todo[i]);
			todo.push(n.p);
		}
	}
	if (!prev.has(k2(tb))) return [ta, tb];
	const path = [];
	for (let p = tb; p; p = prev.get(k2(p))) path.unshift(p);
	return path.length <= 500 ? path : [ta, tb];
}
function bindLineEditor(svg, G) {
	const toGrid = (e) => {
		const r = svg.getBoundingClientRect();
		return [Math.round((e.clientX - r.left) / G), Math.round((e.clientY - r.top) / G)];
	};
	svg.onmousedown = (e) => {
		const h = e.target.closest(".lnhandle"), pt = e.target.closest("[data-lnpart]");
		const at = toGrid(e);
		if (lnEdit.tool === "T") { lnEdit.drawing = { from: at, to: at }; e.preventDefault(); return; }
		if (lnEdit.tool === "R") { lnEdit.rubber = { from: at, to: at }; lnEdit.multi = null; e.preventDefault(); return; }
		// pressed on one of several parts chosen together: they move together
		if (pt && lnEdit.multi?.has(Number(pt.dataset.lnpart))) {
			lnEdit.drag = { which: 0, from: at, many: [...lnEdit.multi].map(i => [i, Object.assign({}, lnEdit.parts[i])]) };
			e.preventDefault();
			return;
		}
		lnEdit.multi = null;
		if (lnEdit.tool) {
			const t = lnEdit.tool, [x, y] = at;
			let p = null;
			if (t === "W") p = { t, x1: x - 3, y1: y - 1, x2: x + 3, y2: y + 1, b: nearTiles(lnEdit.parts, [x, y + 2], false), s: "", f: 0 };
			else if (t === "B") p = { t, x1: x - 3, y1: y - 1, x2: x + 3, y2: y + 1, b: nearTiles(lnEdit.parts, [x, y], true), s: "", f: 0 };
			else if (t === "H") p = { t, x1: x - 2, y1: y - 1, x2: x + 2, y2: y, b: nearTiles(lnEdit.parts, [x, y], true), s: "", f: 0 };
			else {
				const s = prompt(t === "N" ? "駅名" : "盤に書く文字", "");
				if (s) p = { t, x1: x, y1: y, x2: x, y2: y, b: [], s: encodeURIComponent(s), f: 0 };
			}
			if (p) { lnEdit.parts.push(p); lnEdit.sel = lnEdit.parts.length - 1; lnEdit.dirty = true; }
			lnEdit.tool = null;
			renderNetwork();
			return;
		}
		if (h && lnEdit.sel >= 0) lnEdit.drag = { which: Number(h.dataset.h), from: at, orig: Object.assign({}, lnEdit.parts[lnEdit.sel]) };
		else if (pt) {
			const i = Number(pt.dataset.lnpart);
			const again = lnEdit.sel === i;
			lnEdit.sel = i;
			lnEdit.drag = { which: 0, from: at, orig: Object.assign({}, lnEdit.parts[i]) };
			if (!again) renderNetwork();
		}
		else { lnEdit.sel = -1; renderNetwork(); }
		e.preventDefault();
	};
	svg.onmousemove = (e) => {
		if (!lnEdit) return;
		const at = toGrid(e);
		if (lnEdit.drawing || lnEdit.rubber) {
			const r = lnEdit.drawing || lnEdit.rubber;
			if (at[0] !== r.to[0] || at[1] !== r.to[1]) { r.to = at; renderNetwork(); }
			return;
		}
		const d = lnEdit.drag;
		if (d && d.many) {
			const dx = at[0] - d.from[0], dy = at[1] - d.from[1];
			for (const [i, o] of d.many) Object.assign(lnEdit.parts[i], { x1: o.x1 + dx, x2: o.x2 + dx, y1: o.y1 + dy, y2: o.y2 + dy });
			if (dx || dy) { lnEdit.dirty = true; d.moved = true; }
			renderNetwork();
			return;
		}
		if (!d || lnEdit.sel < 0) return;
		const dx = at[0] - d.from[0], dy = at[1] - d.from[1];
		const p = lnEdit.parts[lnEdit.sel], o = d.orig;
		if (d.which === 0) { p.x1 = o.x1 + dx; p.x2 = o.x2 + dx; p.y1 = o.y1 + dy; p.y2 = o.y2 + dy; }
		else if (d.which === 1) { p.x1 = o.x1 + dx; p.y1 = o.y1 + dy; }
		else { p.x2 = o.x2 + dx; p.y2 = o.y2 + dy; }
		for (const k of ["x1", "y1", "x2", "y2"]) p[k] = Math.max(0, p[k]);
		if (dx || dy) { lnEdit.dirty = true; d.moved = true; }
		renderNetwork();
	};
	svg.onmouseup = () => {
		if (!lnEdit) return;
		if (lnEdit.rubber) {
			// the parts that lie in the rectangle (wholly or partly)
			const r = lnEdit.rubber, rx1 = Math.min(r.from[0], r.to[0]), rx2 = Math.max(r.from[0], r.to[0]), ry1 = Math.min(r.from[1], r.to[1]), ry2 = Math.max(r.from[1], r.to[1]);
			lnEdit.rubber = null; lnEdit.tool = null; lnEdit.sel = -1;
			const inside = lnEdit.parts.map((p, i) => p.t !== "Y" && Math.min(p.x1, p.x2) <= rx2 && Math.max(p.x1, p.x2) >= rx1 && Math.min(p.y1, p.y2) <= ry2 && Math.max(p.y1, p.y2) >= ry1 ? i : -1).filter(i => i >= 0);
			lnEdit.multi = inside.length ? new Set(inside) : null;
			renderNetwork();
			return;
		}
		if (lnEdit.drawing) {
			const d = lnEdit.drawing;
			lnEdit.drawing = null;
			if (d.from[0] !== d.to[0] || d.from[1] !== d.to[1]) {
				lnEdit.parts.push({ t: "T", x1: d.from[0], y1: d.from[1], x2: d.to[0], y2: d.to[1], b: lineAutoBind(lnEdit.parts, d.from, d.to), s: "", f: 0 });
				lnEdit.sel = lnEdit.parts.length - 1;
				lnEdit.dirty = true;
			}
			renderNetwork();
			return;
		}
		if (lnEdit.drag) { const moved = lnEdit.drag.moved; lnEdit.drag = null; if (moved) renderNetwork(); }
	};
	svg.ondblclick = (e) => {
		const pt = e.target.closest("[data-lnpart]");
		if (!pt) return;
		const p = lnEdit.parts[Number(pt.dataset.lnpart)];
		if (!"NLH".includes(p.t)) return;
		const s = prompt(p.t === "N" || p.t === "H" ? "駅名" : "文字", lineText(p));
		if (s === null) return;
		p.s = encodeURIComponent(s);
		lnEdit.dirty = true;
		renderNetwork();
	};
}
document.addEventListener("keydown", (e) => {
	if (!lnEdit || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;
	if ((e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase())) { lnUndo(e.key.toLowerCase() === "y" || e.shiftKey); e.preventDefault(); return; }
	if (e.key === "Escape" && (lnEdit.tool || lnEdit.drawing)) { lnEdit.tool = null; lnEdit.drawing = null; renderNetwork(); return; }
	if (lnEdit.sel < 0 && !lnEdit.multi?.size) return;
	if (e.key === "Delete" || e.key === "Backspace") { lnDeleteSelected(); renderNetwork(); e.preventDefault(); return; }
	const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
	if (mv) {
		for (const i of lnEdit.multi?.size ? lnEdit.multi : [lnEdit.sel]) {
			const p = lnEdit.parts[i];
			p.x1 = Math.max(0, p.x1 + mv[0]); p.x2 = Math.max(0, p.x2 + mv[0]); p.y1 = Math.max(0, p.y1 + mv[1]); p.y2 = Math.max(0, p.y2 + mv[1]);
		}
		lnEdit.dirty = true; renderNetwork(); e.preventDefault();
	}
});

// the chosen part, or the parts chosen together, deleted
function lnDeleteSelected() {
	if (!lnEdit) return;
	const gone = lnEdit.multi?.size ? [...lnEdit.multi] : lnEdit.sel >= 0 ? [lnEdit.sel] : [];
	for (const i of gone.sort((a, b) => b - a)) lnEdit.parts.splice(i, 1);
	lnEdit.sel = -1; lnEdit.multi = null;
	if (gone.length) lnEdit.dirty = true;
}
// a new line panel from a draft of the tracks given
async function createLine(name, data) {
	const parts = makeLineDraft(data);
	if (!parts.some(p => p.t === "T")) { toast("その範囲に線路がありません", true); renderNetwork(); return; }
	const r = await commandResult(`ln_new,${encodeURIComponent(name)}`);
	if (!r.ok) { toast("路線盤を作れませんでした: " + tr(r.error), true); renderNetwork(); return; }
	await refreshStatus();
	const made = linesOf().filter(x => x.name === encodeURIComponent(name)).sort((a, b) => b.id - a.id)[0];
	if (!made) return;
	startLineEdit(made, parts);
	lnEdit.dirty = true;
	toast("線路から下書きを作りました。整えてから「適用」してください");
}
// the range of a new line panel: a rectangle dragged on the map of the game
(function () {
	const wrap = document.getElementById("networkMapWrap"), svg = document.getElementById("networkMap");
	if (!wrap || !svg) return;
	let box = null, from = null;
	const tileAt = (e) => {
		const m = networkMapRendered;
		if (!m || m.unit === undefined) return null;
		const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
		const v = pt.matrixTransform(svg.getScreenCTM().inverse());
		return [v.x / m.unit - 1.5 + m.x1, v.y / m.unit - 1.5 + m.y1];
	};
	const place = (a, b) => {
		const r = wrap.getBoundingClientRect();
		Object.assign(box.style, { left: Math.min(a.x, b.x) - r.left + wrap.scrollLeft + "px", top: Math.min(a.y, b.y) - r.top + wrap.scrollTop + "px", width: Math.abs(a.x - b.x) + "px", height: Math.abs(a.y - b.y) + "px" });
	};
	wrap.addEventListener("mousedown", (e) => {
		if (!lnPick) return;
		from = { x: e.clientX, y: e.clientY, tile: tileAt(e) };
		if (!box) { box = document.createElement("div"); box.id = "linePickBox"; wrap.appendChild(box); }
		box.hidden = false;
		place(from, from);
		e.preventDefault();
	});
	wrap.addEventListener("mousemove", (e) => { if (lnPick && from) place(from, { x: e.clientX, y: e.clientY }); });
	wrap.addEventListener("mouseup", (e) => {
		if (!lnPick || !from) return;
		const a = from.tile, b = tileAt(e);
		from = null; box.hidden = true;
		if (!a || !b || Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1) return;
		const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
		const name = lnPick.name;
		lnPick = null;
		createLine(name, Object.assign({}, network, { tiles: network.tiles.filter(t => t.p[0] >= x1 && t.p[0] <= x2 && t.p[1] >= y1 && t.p[1] <= y2) }));
	});
})();
document.getElementById("lineBar").addEventListener("change", (e) => {
	if (e.target.dataset.ln !== "label") return;
	lineLabelMode = e.target.value;
	localStore("line.label", lineLabelMode);
	renderNetwork();
});

function startLineEdit(ln, parts) {
	if (ln.editing !== undefined && !confirm(`「${companyName(ln.editing)}」の人がこの路線盤を編集中です。\n編集を始めますか？後から「適用」した方の内容になります。`)) return;
	lnEdit = { id: ln.id, parts: JSON.parse(JSON.stringify(parts)), sel: -1, tool: null, undo: [], redo: [], dirty: false, rev: ln.rev };
	lnEdit.last = JSON.stringify(lnEdit.parts);
	command(`ln_edit,${ln.id},1`, "路線盤の編集を開始");
	lineView = String(ln.id);
	renderNetwork();
}
function endLineEdit() {
	if (lnEdit) command(`ln_edit,${lnEdit.id},0`, "路線盤の編集を終了");
	lnEdit = null;
}

document.getElementById("lineBar").addEventListener("click", async (e) => {
	const b = e.target.closest("button[data-ln]");
	if (!b) return;
	const c = b.dataset.ln;
	const ln = lnEdit ? linesOf().find(x => x.id === lnEdit.id) : shownLine();
	if (c === "view") {
		lineView = b.dataset.id;
		localStore("line.view", lineView);
		networkMapZoom = 1;
		renderNetwork();
	}
	else if (c === "new") {
		if (!network?.tiles?.length) { toast("線路の情報を取得中です。しばらくしてからもう一度押してください", true); return; }
		const name = prompt("路線盤の名前（例：京王線）", "");
		if (!name) return;
		// the range: dragged on the map, or all the connected tracks
		lnPick = { name };
		lineView = "map";
		renderNetwork();
	}
	else if (c === "pickall" && lnPick) { const name = lnPick.name; lnPick = null; createLine(name, network); }
	else if (c === "pickcancel") { lnPick = null; renderNetwork(); }
	else if (c === "label") return;
	else if (c === "edit" && ln) { const parts = lineParts(ln); if (parts) startLineEdit(ln, parts); }
	else if (c === "rename" && ln) {
		const name = prompt("路線盤の名前", lineName(ln));
		if (!name || name === lineName(ln)) return;
		const r = await commandResult(`ln_name,${ln.id},${encodeURIComponent(name)}`);
		if (!r.ok) toast("名前を変えられませんでした: " + tr(r.error), true);
		await refreshStatus(); renderNetwork();
	}
	else if (c === "remove" && ln) {
		if (!confirm(`路線盤「${lineName(ln)}」を削除しますか？（全員の盤から消えます）`)) return;
		const r = await commandResult(`ln_del,${ln.id}`);
		if (!r.ok) toast("削除できませんでした: " + tr(r.error), true);
		lineView = "map"; localStore("line.view", lineView);
		await refreshStatus(); renderNetwork();
	}
	else if (!lnEdit) return;
	else if (c === "tool") { lnEdit.tool = lnEdit.tool === b.dataset.t ? null : b.dataset.t; renderNetwork(); }
	else if (c === "clock") { lnEdit.parts.push({ t: "C", x1: 8, y1: 2, x2: 8, y2: 2, b: [], s: "", f: 0 }); lnEdit.sel = lnEdit.parts.length - 1; lnEdit.dirty = true; renderNetwork(); }
	else if (c === "colors") { editLineColors(); return; }
	else if (c === "rotate") { lnEdit.parts = rotateLine(lnEdit.parts); lnEdit.sel = -1; lnEdit.multi = null; lnEdit.dirty = true; renderNetwork(); }
	else if (c === "flip" || c === "small") { const p = lnEdit.parts[lnEdit.sel]; if (p) { p.f = (p.f || 0) ^ 1; lnEdit.dirty = true; renderNetwork(); } }
	else if (c === "del" && (lnEdit.sel >= 0 || lnEdit.multi?.size)) { lnDeleteSelected(); renderNetwork(); }
	else if (c === "undo" || c === "redo") lnUndo(c === "redo");
	else if (c === "draft") {
		if (!confirm("線路から下書きを作り直しますか？編集した内容は消えます。")) return;
		lnEdit.parts = makeLineDraft(network); lnEdit.sel = -1; lnEdit.dirty = true; renderNetwork();
	}
	else if (c === "cancel") {
		if (lnEdit.dirty && !confirm("編集した内容を捨てますか？")) return;
		endLineEdit(); renderNetwork();
	}
	else if (c === "apply") {
		// somebody else applied this line panel since this editing started: theirs would be replaced
		if (ln && ln.rev !== lnEdit.rev && !confirm("編集を始めたあとに、ほかの人がこの路線盤を保存しています。\nその内容を、この編集で置き換えますか？")) return;
		const id = lnEdit.id, parts = lnEdit.parts;
		const r = await uploadLine(id, parts);
		if (r.ok) { toast("路線盤を保存しました"); lnEdit = null; lineView = String(id); localStore("line.view", lineView); }
		else toast("保存できませんでした: " + tr(r.error), true);
		await refreshStatus(); renderNetwork();
	}
	lnTrack();
	if (lnEdit) renderNetwork();
});

// ---------------------------------------------------------------------------
// a small window over the page: the details of a train, the colour rules
// ---------------------------------------------------------------------------
function lineModal(html) {
	let m = document.getElementById("lnModal");
	if (!m) { m = document.createElement("div"); m.id = "lnModal"; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }); }
	m.innerHTML = `<div class="lnbox">${html}</div>`;
	m.hidden = false;
	return m;
}
const hhmm = (t) => t == null ? "" : `${Math.floor(((t % 86400) + 86400) % 86400 / 3600)}:${String(Math.floor(((t % 86400) + 86400) % 86400 / 60) % 60).padStart(2, "0")}`;
// the details of a train (列車の詳細) and its numbers given by hand
function openTrainDetail(t) {
	const c = t.convoy, tag = trainTag(c.name);
	const delay = t.delay.seconds == null ? "遅れ不明" : t.minutes ? `遅れ${t.minutes}分` : "定刻";
	const stops = t.entry ? t.entry.stops.slice(t.entry.from, t.entry.to + 1).filter(s => s.arrival != null || s.departure != null) : [];
	const m = lineModal(`<div class="lnhead"><b>列番：${esc(t.number)}</b><button data-x="close">×</button></div>
		<p><b>${t.cars ? t.cars + "両編成" : ""}</b>　<b class="${t.minutes ? "late" : ""}">${delay}</b></p>
		<p>${t.type ? `<span class="lntype">${esc(t.type)}</span>　` : ""}${t.destination ? esc(displayStationName(t.destination)) + "　行き" : ""}</p>
		<p class="hint">ゲームの列車：${esc(c.name)}（運用番号 ${esc(t.op)}）${c.line ? `／スケジュール：${esc(c.line)}` : ""}${t.entry ? "" : "／ダイヤの列車は特定できていません"}</p>
		${stops.length ? `<table class="lntable"><tr><th>駅</th><th>到着時刻</th><th>発車時刻</th></tr>${stops.map(s => `<tr><td>${esc(displayStationName(s.name))}</td><td>${s.arrival == null ? "—" : hhmm(s.arrival)}</td><td>${s.departure == null ? "—" : hhmm(s.departure)}</td></tr>`).join("")}</table>` : ""}
		<h3>手で付け直す（全員の盤に反映、ゲームに保存）</h3>
		<p class="hint">ダイヤと合わない列車に。ゲームの列車名「${esc(c.name)}」に結びつきます（同じ名前の列車も同じになります）。</p>
		<div class="row"><label>運用番号 <input data-x="op" value="${esc(tag?.op || "")}" placeholder="${esc(operationNumber(c.name))}"></label>
		<label>列番 <input data-x="num" value="${esc(tag?.number || "")}" placeholder="自動"></label>
		<label><input type="checkbox" data-x="red" ${tag && tag.flags & 1 ? "checked" : ""}> 特殊列番（赤）</label></div>
		<div class="row"><button data-x="save" class="primary">保存</button><button data-x="clear" ${tag ? "" : "disabled"}>元に戻す</button></div>`);
	m.querySelector("[data-x=close]").onclick = () => { m.hidden = true; };
	const send = async (cmd) => {
		const r = await commandResult(cmd);
		if (!r.ok) { toast("保存できませんでした: " + tr(r.error), true); return; }
		m.hidden = true;
		await refreshStatus(); renderNetwork();
	};
	m.querySelector("[data-x=save]").onclick = () => {
		const op = m.querySelector("[data-x=op]").value.trim(), num = m.querySelector("[data-x=num]").value.trim(), red = m.querySelector("[data-x=red]").checked;
		send(`tr_tag,${encodeURIComponent(c.name)},${encodeURIComponent(op)},${encodeURIComponent(num)},${red ? 1 : 0}`);
	};
	m.querySelector("[data-x=clear]").onclick = () => send(`tr_untag,${encodeURIComponent(c.name)}`);
}
// the colour rules of the line panel being edited (kept in its style part on 適用)
function editLineColors() {
	if (!lnEdit) return;
	const rules = lineRules(lnEdit.parts).map(r => Object.assign({}, r));
	const kinds = [["cars", "両数が"], ["type", "種別が"], ["number", "列番が"], ["op", "運用番号が"]];
	const draw = () => {
		const m = lineModal(`<div class="lnhead"><b>列番の色分け</b><button data-x="close">×</button></div>
			<p class="hint">上から順に調べ、最初に当てはまった色にします。どれにも当たらなければ橙、手で「特殊列番」にした列車は赤。
			両数は数、ほかは正規表現（例：種別「快速」、列番「T$」＝末尾が T）。</p>
			<table class="lntable">${rules.map((r, i) => `<tr><td><select data-i="${i}" data-f="k">${kinds.map(([k, l]) => `<option value="${k}" ${r.k === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
				<td><input data-i="${i}" data-f="v" value="${esc(r.v || "")}"></td><td><input type="color" data-i="${i}" data-f="c" value="${esc(r.c || "#ffffff")}"></td>
				<td><button data-i="${i}" data-x="del">削除</button></td></tr>`).join("")}</table>
			<div class="row"><button data-x="add">＋条件</button><span class="sep"></span><button data-x="ok" class="primary">決定</button><button data-x="close2">やめる</button></div>
			<p class="hint">「決定」のあと、編集の「適用」でゲームに保存されます。</p>`);
		const read = () => m.querySelectorAll("[data-f]").forEach(e => { rules[Number(e.dataset.i)][e.dataset.f] = e.value; });
		m.querySelector("[data-x=close]").onclick = m.querySelector("[data-x=close2]").onclick = () => { m.hidden = true; };
		m.querySelector("[data-x=add]").onclick = () => { read(); rules.push({ k: "cars", v: "10", c: "#ffd400" }); draw(); };
		m.querySelectorAll("[data-x=del]").forEach(b => b.onclick = () => { read(); rules.splice(Number(b.dataset.i), 1); draw(); });
		m.querySelector("[data-x=ok]").onclick = () => {
			read();
			let y = lnEdit.parts.find(p => p.t === "Y");
			if (!y) { y = { t: "Y", x1: 0, y1: 0, x2: 0, y2: 0, b: [], s: "", f: 0 }; lnEdit.parts.push(y); }
			const s = encodeURIComponent(JSON.stringify({ rules: rules.filter(r => r.v !== "").map(r => ({ k: r.k, v: r.v, c: r.c })) }));
			if (s.length > 1900) { toast("色分けの条件が多すぎます（減らしてください）", true); return; }
			y.s = s;
			lnEdit.dirty = true; lnTrack();
			m.hidden = true; renderNetwork();
		};
	};
	draw();
}
