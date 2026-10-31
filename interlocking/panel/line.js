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
const LINE_KEEP = 4;   // columns / rows of plain straight track kept of a long stretch
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
	// 1. shorten: a column of nothing but plain east-west track (no station, no signal) can go, keeping a few
	const xs = [...tiles.values()].map(t => t.p[0]), ys = [...tiles.values()].map(t => t.p[1]);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
	const plain = (t, r) => t.r === r && !t.halt && !t.s;
	function squeeze(lo, hi, cells, r) {
		const map = new Map();
		let c = 0, run = 0;
		for (let v = lo; v <= hi; v++) {
			const cs = cells(v);
			const removable = cs.every(t => plain(t, r));
			run = removable ? run + 1 : 0;
			// a gap without any track keeps one column, plain track a few
			const keep = removable ? (cs.length ? LINE_KEEP : 1) : Infinity;
			if (run <= keep) c++;
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
	const cx = squeeze(x0, x1, v => byX.get(v) || [], E | W), cy = squeeze(y0, y1, v => byY.get(v) || [], N | S);
	const G = (t) => [2 * cx.get(t.p[0]) + 1, 2 * cy.get(t.p[1]) + 1];
	// 2. chains of track between nodes (junctions, ends, signals, the edges of stations): one line each, or a
	// few straight lines where it bends
	const node = (t) => { const l = links(t); return l.length !== 2 || !!t.s || l.some(d => !!nb(t, d).halt !== !!t.halt); };
	const parts = [], seen = new Set();
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
	// a loop without any node
	for (const t of tiles.values()) for (const d of links(t)) if (!seen.has(edgeKey(t, d))) chains.push(chainFrom(t, d));
	for (const chain of chains) {
		const pts = chain.map(G);
		// drop points on the way of a straight line (also stairs of a diagonal and gentle curves: within 1.2 steps)
		const keep = [0];
		for (let i = 1; i < pts.length; i++) {
			const a = pts[keep[keep.length - 1]];
			const ok = (j) => {
				const b = pts[j], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
				for (let m = keep[keep.length - 1] + 1; m < j; m++) {
					const q = pts[m];
					if (Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / len > 1.2) return false;
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
	// 3. stations: the platform tiles of each stop, its platform tracks (tiles of the stop joined by track)
	const stops = new Map();
	for (const t of tiles.values()) if (t.halt) { if (!stops.has(t.halt)) stops.set(t.halt, []); stops.get(t.halt).push(t); }
	const boxes = [];   // rectangles taken (windows must not cover them)
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
				parts.push(Object.assign({ t: "B", b: comp.map(t => t.p), s: "", f: below }, box));
				take({ x1: box.x1, x2: box.x2, y1: below ? box.y1 : box.y1 - 3, y2: below ? box.y2 + 3 : box.y2 });
			}
			const cxm = Math.round((sx1 + sx2) / 2);
			parts.push({ t: "N", x1: cxm, y1: sy1 - 5, x2: cxm, y2: sy1 - 5, b: [], s: encodeURIComponent(name), f: 0 });
			take({ x1: cxm - 4, x2: cxm + 4, y1: sy1 - 7, y2: sy1 - 4 });
		}
		else {
			// between its tracks (or beside the one track): the platform, the name above
			const h = sy1 === sy2 ? { x1: sx1 - 1, y1: sy1 - 2, x2: Math.max(sx2 + 1, sx1 + 2), y2: sy1 - 1 } : { x1: sx1 - 1, y1: Math.round(mid) - 1, x2: Math.max(sx2 + 1, sx1 + 2), y2: Math.round(mid) + 1 };
			parts.push(Object.assign({ t: "H", b: ts.map(t => t.p), s: encodeURIComponent(name), f: 0 }, h));
			const cxm = Math.round((sx1 + sx2) / 2);
			parts.push({ t: "N", x1: cxm, y1: sy1 - 3, x2: cxm, y2: sy1 - 3, b: [], s: encodeURIComponent(name), f: 1 });
			take({ x1: h.x1, x2: h.x2, y1: sy1 - 4, y2: h.y2 });
		}
	}
	// 4. train number windows: on the long straight lines between stations, above an upper track, below a
	// lower one (the window shows the trains of the block of that line)
	const lines = parts.filter(p => p.t === "T" && p.y1 === p.y2 && Math.abs(p.x2 - p.x1) >= 8 && !p.b.some(q => tiles.get(q[0] + "," + q[1])?.halt));
	for (const p of lines) {
		const lx1 = Math.min(p.x1, p.x2), lx2 = Math.max(p.x1, p.x2), y = p.y1;
		const parallel = (dy) => parts.some(q => q.t === "T" && q !== p && q.y1 === q.y2 && q.y1 - y === dy && Math.min(q.x1, q.x2) < lx2 && Math.max(q.x1, q.x2) > lx1);
		const up = [1, 2, 3, 4, 5, 6].some(dy => parallel(-dy)), down = [1, 2, 3, 4, 5, 6].some(dy => parallel(dy));
		// a track between two others (the throat of a station): no room for a window
		if (up && down) continue;
		const below = up;
		const w = 6, x = Math.round((lx1 + lx2) / 2 - w / 2);
		const r = below ? { x1: x, y1: y + 1, x2: x + w, y2: y + 3 } : { x1: x, y1: y - 3, x2: x + w, y2: y - 1 };
		if (!free(r)) continue;
		take(r);
		const sig = p.b.map(q => tiles.get(q[0] + "," + q[1])?.s).find(s => s && [N, E, S, W].includes(s.dir));
		parts.push(Object.assign({ t: "W", b: p.b, s: "", f: sig ? sig.dir : 0 }, r));
	}
	// 5. the clock at the top left; everything starts at (2,2)
	const placed = parts.slice();
	const minX = Math.min(...placed.flatMap(p => [p.x1, p.x2])), minY = Math.min(...placed.flatMap(p => [p.y1, p.y2]));
	parts.push({ t: "C", x1: minX + 5, y1: minY - 4, x2: minX + 5, y2: minY - 4, b: [], s: "", f: 0 });
	const ox = 2 - Math.min(...parts.flatMap(p => [p.x1, p.x2])) + 5, oy = 2 - Math.min(...parts.flatMap(p => [p.y1, p.y2])) + 2;
	for (const p of parts) { p.x1 += ox; p.x2 += ox; p.y1 += oy; p.y2 += oy; }
	return parts;
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------
const lineText = (p) => { try { return decodeURIComponent(p.s || ""); } catch (e) { return p.s || ""; } };
function renderLineMap(svg, wrap, parts, data) {
	const placed = parts.filter(p => p.t !== "Y");
	// a station name reaches beyond its point: about its number of characters times its size (in steps)
	const reach = (p) => p.t === "N" ? (lineText(p).length * (p.f & 1 ? .75 : 1.1) + 1) : p.t === "C" ? 4 : 0;
	const GW = Math.max(20, Math.max(...placed.flatMap(p => [p.x1 + reach(p), p.x2 + reach(p)]), 0) + 4), GH = Math.max(12, Math.max(...placed.flatMap(p => [p.y1, p.y2]), 0) + 6);
	const fit = Math.min((wrap.clientWidth - 24) / GW, (wrap.clientHeight - 24) / GH);
	const G = Math.max(3, Math.min(40, (fit || 10) * networkMapZoom));   // pixels per grid step
	// the blue fills the frame even when the drawing is smaller
	const SW = Math.max(GW * G, wrap.clientWidth - 2), SH = Math.max(GH * G, wrap.clientHeight - 2);
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
	const occupied = new Set((data?.convoys || []).flatMap(c => c.occupied.map(p => p.join(","))));
	const order = { F: 0, H: 1, T: 2, W: 3, B: 4, N: 5, L: 5, C: 5, Y: -1 };
	const idx = parts.map((p, i) => i).sort((a, b) => (order[parts[a].t] ?? 5) - (order[parts[b].t] ?? 5));
	const rect = (p) => ({ x: X(Math.min(p.x1, p.x2)), y: Y(Math.min(p.y1, p.y2)), width: Math.max(2, Math.abs(X(p.x2 - p.x1))), height: Math.max(2, Math.abs(Y(p.y2 - p.y1))) });
	for (const i of idx) {
		const p = parts[i];
		if (p.t === "Y") continue;
		const grp = el("g", { class: (lnEdit ? "lnpart" : "") + (lnEdit && lnEdit.sel === i ? " sel" : ""), "data-lnpart": i }, svg);
		if (p.t === "T") {
			const red = (p.b || []).some(t => occupied.has(t.join(",")));
			const color = red ? "#ff3b30" : "#eef3ff";
			el("line", { x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), stroke: color, "stroke-width": Math.max(2, G * .32), "stroke-linecap": "square" }, grp);
			// the small marks across the track, as on the TID
			el("line", { x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), stroke: color, "stroke-width": Math.max(4, G * .7), "stroke-dasharray": `1 ${Math.max(4, G * 1.2)}`, opacity: .8 }, grp);
			if (lnEdit) el("line", { x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), stroke: "transparent", "stroke-width": 14 }, grp);
		}
		else if (p.t === "W" || p.t === "B") {
			const r = rect(p);
			el("rect", Object.assign({ fill: "#0b2c99", stroke: "#5d82ff", "stroke-width": 1.2 }, r), grp);
			if (p.t === "W") {
				// the train number and, at the right, the delay in minutes
				const dx = r.x + r.width - Math.min(r.width / 3, G * 1.6);
				el("line", { x1: dx, y1: r.y, x2: dx, y2: r.y + r.height, stroke: "#5d82ff", "stroke-width": 1 }, grp);
			}
			else {
				const s = G * 1.6, cxm = r.x + r.width / 2;
				el("rect", { x: cxm - s / 2, y: p.f & 1 ? r.y + r.height + G * .6 : r.y - G * .6 - s, width: s, height: s, fill: "#0b2c99", stroke: "#5d82ff", "stroke-width": 1.2 }, grp);
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
		else if (p.t === "C") el("text", { x: X(p.x1), y: Y(p.y1), "font-size": Math.max(9, G * 1.3), fill: "#ffffff", "font-family": "monospace", "text-anchor": "middle", "dominant-baseline": "middle" }, grp).textContent = data?.time || clockOf(status).hms;
	}
	if (lnEdit && parts[lnEdit.sel] && "TWBHF".includes(parts[lnEdit.sel].t)) {
		const p = parts[lnEdit.sel];
		for (const [x, y, h] of [[p.x1, p.y1, 1], [p.x2, p.y2, 2]]) el("rect", { x: X(x) - 5, y: Y(y) - 5, width: 10, height: 10, fill: "#ffe066", stroke: "#000", class: "lnhandle", "data-h": h }, svg);
	}
	if (lnEdit && lnEdit.drawing) {
		const d = lnEdit.drawing;
		el("line", { x1: X(d.from[0]), y1: Y(d.from[1]), x2: X(d.to[0]), y2: Y(d.to[1]), stroke: "#ffe066", "stroke-width": 4, "stroke-dasharray": "8 6", "pointer-events": "none" }, svg);
	}
	if (lnEdit) bindLineEditor(svg, G);
	else svg.onmousedown = svg.onmousemove = svg.onmouseup = svg.ondblclick = null;
}

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
	if (!parts) { svg.replaceChildren(); return; }
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
			`<button data-ln="clock">時計</button><span class="sep"></span>` +
			(sel && sel.t === "B" ? `<button data-ln="flip" title="遅延表示の箱を上下入れ替える">遅延の箱を${sel.f & 1 ? "上" : "下"}へ</button>` : "") +
			(sel && sel.t === "N" ? `<button data-ln="small" title="大きな駅名（枠つき）と小さな駅名を切り替える">${sel.f & 1 ? "大きな駅名に" : "小さな駅名に"}</button>` : "") +
			`<button data-ln="del" ${sel ? "" : "disabled"} title="選んだ部品を消す（Delete キー）">削除</button>` +
			`<button data-ln="undo" ${lnEdit.undo.length ? "" : "disabled"} title="元に戻す（Ctrl+Z）">↶ 戻す</button><button data-ln="redo" ${lnEdit.redo.length ? "" : "disabled"} title="やり直す（Ctrl+Y）">↷</button>` +
			`<button data-ln="draft" title="線路から下書きを作り直す（編集した内容は消えます）">下書きを作り直す</button>` +
			`<button data-ln="apply" class="primary" title="ゲームに保存して全員の盤に反映する">適用</button><button data-ln="cancel">やめる</button>`;
	}
	const tabs = `<button data-ln="view" data-id="map" class="${!ln ? "on" : ""}" title="ゲームの線路をそのまま描いた地図">地図</button>` +
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
		if (lnEdit.drawing) {
			if (at[0] !== lnEdit.drawing.to[0] || at[1] !== lnEdit.drawing.to[1]) { lnEdit.drawing.to = at; renderNetwork(); }
			return;
		}
		const d = lnEdit.drag;
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
	if (lnEdit.sel < 0) return;
	if (e.key === "Delete" || e.key === "Backspace") { lnEdit.parts.splice(lnEdit.sel, 1); lnEdit.sel = -1; lnEdit.dirty = true; renderNetwork(); e.preventDefault(); return; }
	const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
	if (mv) {
		const p = lnEdit.parts[lnEdit.sel];
		p.x1 = Math.max(0, p.x1 + mv[0]); p.x2 = Math.max(0, p.x2 + mv[0]); p.y1 = Math.max(0, p.y1 + mv[1]); p.y2 = Math.max(0, p.y2 + mv[1]);
		lnEdit.dirty = true; renderNetwork(); e.preventDefault();
	}
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
		const parts = makeLineDraft(network);
		const r = await commandResult(`ln_new,${encodeURIComponent(name)}`);
		if (!r.ok) { toast("路線盤を作れませんでした: " + tr(r.error), true); return; }
		await refreshStatus();
		const made = linesOf().filter(x => x.name === encodeURIComponent(name)).sort((a, b) => b.id - a.id)[0];
		if (!made) return;
		startLineEdit(made, parts);
		lnEdit.dirty = true;
		toast("線路から下書きを作りました。整えてから「適用」してください");
	}
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
	else if (c === "flip" || c === "small") { const p = lnEdit.parts[lnEdit.sel]; if (p) { p.f = (p.f || 0) ^ 1; lnEdit.dirty = true; renderNetwork(); } }
	else if (c === "del" && lnEdit.sel >= 0) { lnEdit.parts.splice(lnEdit.sel, 1); lnEdit.sel = -1; lnEdit.dirty = true; renderNetwork(); }
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
