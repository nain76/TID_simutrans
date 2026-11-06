// Draft of a line panel (路線盤) from the tracks of a network, on a made-up double track line:
// small stations, a station with points and a third track, a branch going north, long plain stretches.
//   node interlocking/tests/line_draft_test.mjs [svg file to write the draft to, to look at]
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, localStorage: { getItem: () => null, setItem() {} },
	document: { getElementById: () => ({ addEventListener() {} }), addEventListener() {} } });
const run = (code) => vm.runInContext(code, context);
run(`const N = 1, E = 2, S = 4, W = 8, DIRS = [N, E, S, W], DXY = { 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] }, BACK = { 1: 4, 2: 8, 4: 1, 8: 2 };
	const localStore = () => null; let networkMapZoom = 1, network = null, status = { lines: [], routes: [] };`);
run(fs.readFileSync(new URL("../panel/line.js", import.meta.url), "utf8"));

// the network: tiles { p, r, halt, s }
const tiles = new Map();
const put = (x, y, r, extra = {}) => { const k = x + "," + y; const t = tiles.get(k) || { p: [x, y, 0], r: 0 }; t.r |= r; Object.assign(t, extra); tiles.set(k, t); };
const hline = (x1, x2, y) => { for (let x = x1; x <= x2; x++) put(x, y, (x > x1 ? 8 : 0) | (x < x2 ? 2 : 0)); };
const vline = (x, y1, y2) => { for (let y = y1; y <= y2; y++) put(x, y, (y > y1 ? 1 : 0) | (y < y2 ? 4 : 0)); };
hline(0, 300, 20); hline(0, 300, 22);                     // the double track
for (const [x1, x2, name] of [[40, 45, "小駅A"], [80, 85, "小駅B"]]) for (let x = x1; x <= x2; x++) { put(x, 20, 0, { halt: name }); put(x, 22, 0, { halt: name }); }
// a station with points: a third track (y = 24) joined at x = 150 and x = 170, platforms on all three
put(150, 22, 4); vline(150, 22, 24); hline(150, 170, 24); put(170, 22, 4); vline(170, 22, 24);
for (let x = 155; x <= 165; x++) for (const y of [20, 22, 24]) put(x, y, 0, { halt: "大駅" });
// a crossover between the tracks at x = 140
put(140, 20, 4); vline(140, 20, 22);
// a branch going north at x = 250, then east, with a station at its end
put(250, 20, 1); vline(250, 2, 20); put(250, 2, 2); hline(250, 320, 2);
for (let x = 310; x <= 318; x++) put(x, 2, 0, { halt: "終点" });
// a diagonal going south-east from the end of the lower track (stairs of curves), with signals on it
{ let x = 300, y = 22; put(300, 22, 4 | 8); for (let i = 0; i < 30; i++) { put(x, y + 1, 1 | 2); put(x + 1, y + 1, 8 | 4); x++; y++; if (i % 10 === 5) tiles.get(x + "," + y).s = { dir: 4, aspect: "red", name: "閉塞" }; } put(x, y + 1, 1); }
// signals on the main tracks
put(60, 20, 0, { s: { dir: 2, aspect: "red", name: "閉塞" } }); put(60, 22, 0, { s: { dir: 8, aspect: "red", name: "閉塞" } });
put(120, 20, 0, { s: { dir: 2, aspect: "red", name: "閉塞" } }); put(120, 22, 0, { s: { dir: 8, aspect: "red", name: "閉塞" } });
const data = { tiles: [...tiles.values()], convoys: [] };

context.data = data;
const parts = run("makeLineDraft(data)");
const of = (t) => parts.filter(p => p.t === t);
const name = (p) => decodeURIComponent(p.s);
// 1. long plain stretches shortened: 320 tiles of line become far fewer steps
const tx = of("T").flatMap(p => [p.x1, p.x2]);
assert.ok(Math.max(...tx) - Math.min(...tx) < 2 * 320 / 2, `shortened (${Math.max(...tx) - Math.min(...tx)} steps for 320 tiles)`);
// every track tile is on some line
const bound = new Set(of("T").flatMap(p => p.b.map(t => t.join(","))));
assert.equal([...tiles.values()].filter(t => !bound.has(t.p.join(","))).length, 0, "every track tile stands on a line");
// 2. stations: the big one has number boxes on its three tracks and a framed name; the small ones a platform and a small name
const boxes = of("B");
assert.equal(boxes.length, 3, "the station with points: a number box on each of its 3 tracks");
assert.ok(boxes.every(b => b.b.every(t => tiles.get(t[0] + "," + t[1]).halt === "大駅")), "the boxes stand for the platform tiles");
assert.equal(JSON.stringify(boxes.map(b => b.f & 1).sort()), "[0,1,1]", "delay box above the upper track, below the others");
assert.ok(of("N").some(p => name(p) === "大駅" && !(p.f & 1)), "its name, framed");
for (const s of ["小駅A", "小駅B", "終点"]) {
	assert.ok(of("H").some(p => name(p) === s), `${s}: a platform mark`);
	assert.ok(of("N").some(p => name(p) === s && p.f & 1), `${s}: a small name`);
}
const ha = of("H").find(p => name(p) === "小駅A");
const yUp = of("T").find(p => p.b.some(t => t.join(",") === "10,20,0")).y1, yDown = of("T").find(p => p.b.some(t => t.join(",") === "10,22,0")).y1;
assert.ok(Math.min(ha.y1, ha.y2) >= yUp - 1 && Math.max(ha.y1, ha.y2) <= yDown + 1, "the platform of a small station lies between its tracks");
// 3. train number windows: above the upper track, below the lower one; none over a station
const wins = of("W");
assert.ok(wins.length >= 4, `windows between the stations (${wins.length})`);
assert.ok(wins.some(w => w.y2 <= yUp) && wins.some(w => w.y1 >= yDown), "above the upper track and below the lower one");
const rects = [...boxes, ...of("H")];
assert.ok(!wins.some(w => rects.some(r => w.x1 < Math.max(r.x1, r.x2) && w.x2 > Math.min(r.x1, r.x2) && w.y1 < Math.max(r.y1, r.y2) + 3 && w.y2 > Math.min(r.y1, r.y2) - 3)), "no window over a station");
assert.ok(wins.some(w => w.f === 2) && wins.some(w => w.f === 8), "the direction of a window from the signals of its block");
assert.ok(!wins.some(w => w.y1 > yUp && w.y2 < yDown), "no window between the two tracks");
// 4. the branch is there, going north; the clock
assert.ok(of("T").some(p => p.x1 === p.x2 && Math.abs(p.y2 - p.y1) > 2), "the branch going north is a vertical line");
assert.equal(of("C").length, 1, "a clock");
assert.ok(parts.every(p => p.x1 >= 0 && p.y1 >= 0 && p.x2 >= 0 && p.y2 >= 0), "all on the panel");

// 5. what moves: blocks between signals, train numbers in windows / boxes, routes
const train = (id, tiles, dir, name) => ({ id, name, pos: tiles[0], dir, occupied: tiles });
const run2 = (expr) => JSON.parse(run(`JSON.stringify(${expr})`));
context.moving = Object.assign({}, data, { seconds: 0, convoys: [
	train(1, [[70, 20, 0], [69, 20, 0]], 2, "東行き"),          // upper track, between the signals at 60 and 120, going east
	train(2, [[100, 22, 0], [101, 22, 0]], 8, "西行き"),        // lower track, going west
	train(3, [[160, 22, 0], [159, 22, 0]], 2, "大駅停車"),      // at the station
	train(4, [[200, 20, 0], [199, 20, 0]], 8, "逆走"),          // upper track going west: no window shows that way
] });
context.parts = parts;
context.label = (c) => ({ number: c.name, minutes: c.id === 2 ? 3 : 0 });
const places = run2("[...lineTrainPlaces(parts, moving, label)].map(([i, l]) => [parts[i].t, parts[i].f, l.number, l.minutes, parts[i].b.map(t => t.join(','))])");
const placed = (n) => places.find(p => p[2] === n);
assert.ok(placed("東行き") && placed("東行き")[0] === "W" && placed("東行き")[1] === 2 && placed("東行き")[4].every(k => { const [x, y] = k.split(",").map(Number); return y === 20 && x > 60 && x < 120; }), `the eastbound train in the window of its block (${JSON.stringify(placed("東行き"))})`);
assert.ok(placed("西行き") && placed("西行き")[0] === "W" && placed("西行き")[1] === 8 && placed("西行き")[3] === 3, "the westbound train in the window below, with its delay");
assert.ok(placed("大駅停車") && placed("大駅停車")[0] === "B" && placed("大駅停車")[4].includes("160,22,0"), "the train at the station in the number box of its track");
assert.ok(!placed("逆走") || placed("逆走")[1] === 0, "a train going the other way: not in the windows of the eastbound track (a single track window, both ways, may show it)");
// where a tile is drawn on the panel, and whether a red stretch covers it
const gridOf = (k) => { const p = of("T").find(q => q.b.some(t => t.join(",") === k)); const i = p.b.findIndex(t => t.join(",") === k), f = p.b.length > 1 ? i / (p.b.length - 1) : 0; return [p.x1 + (p.x2 - p.x1) * f, p.y1 + (p.y2 - p.y1) * f]; };
const covers = (spans, k) => { const [x, y] = gridOf(k); return spans.some(([ax, ay, bx, by]) => Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < 1e-6 && x >= Math.min(ax, bx) - 1e-6 && x <= Math.max(ax, bx) + 1e-6 && y >= Math.min(ay, by) - 1e-6 && y <= Math.max(ay, by) + 1e-6); };
const red = run2("lineOccupied(parts, moving)");
assert.ok(covers(red, "90,20,0") && covers(red, "61,20,0") && covers(red, "119,20,0"), "the whole block of the eastbound train is red (60 to 120)");
assert.ok(!covers(red, "50,20,0") && !covers(red, "130,20,0"), "the blocks behind the signal at 60 and beyond the one at 120 are not red");
// the throat of the big station: a train on the main track by the point at 150 does not make the third track red
context.throat = Object.assign({}, data, { seconds: 0, convoys: [train(5, [[152, 22, 0], [151, 22, 0]], 2, "構内")] });
const red2 = run2("lineOccupied(parts, throat)");
assert.ok(covers(red2, "152,22,0"), "the train's own track is red");
assert.ok(!covers(red2, "150,23,0") && !covers(red2, "152,24,0"), "the track the point leads to is not (blocks end at points, like track circuits)");
run("status.routes = [{ state: 'set', tiles: [[152, 24, 0], [153, 24, 0], [154, 24, 0], [155, 24, 0]] }, { state: 'idle', tiles: [[10, 20, 0], [11, 20, 0]] }]");
const spans = run2("lineRouteSpans(parts)");
const third = of("T").find(p => p.b.some(t => t.join(",") === "153,24,0"));
assert.ok(spans.length >= 1 && spans.every(sp => sp[1] === third.y1 && sp[3] === third.y1), "a set route drawn on the line(s) of the third track, an idle one not");

// 6. colours of the train numbers: rules kept in the style part, the first fitting one; red given by hand
run(`var ruled = [{ t: "Y", x1: 0, y1: 0, x2: 0, y2: 0, b: [], f: 0, s: encodeURIComponent(JSON.stringify({ rules: [
	{ k: "cars", v: "10", c: "#ffd400" }, { k: "cars", v: "8", c: "#ffffff" }, { k: "type", v: "臨時", c: "#40ff60" }, { k: "number", v: "T$", c: "#40d0ff" }, { k: "op", v: "(", c: "#000" } ] })) }];
	var rules = lineRules(ruled);`);
const color = (t) => run(`lineNumberColor(rules, ${JSON.stringify(t)})`);
assert.equal(color({ cars: 10, number: "201" }), "#ffd400", "10 cars");
assert.equal(color({ cars: 8, number: "201" }), "#ffffff", "8 cars");
assert.equal(color({ cars: 6, number: "201", type: "臨時急行" }), "#40ff60", "by the type");
assert.equal(color({ cars: 6, number: "9999T" }), "#40d0ff", "by the train number (regular expression)");
assert.equal(color({ cars: 6, number: "201", op: "A01" }), "#ffb31a", "none fits: orange (a broken expression fits nothing)");
assert.equal(color({ cars: 10, number: "201", red: true }), "#ff4040", "marked red by hand wins");
assert.equal(run("lineRules([]).length"), 0, "no style part: no rules");

// 7. the diagonal: one straight slanting line (not stairs), though signals stand on it
const diag = of("T").filter(p => p.b.some(t => t[0] > 302 && t[1] > 24));
assert.ok(diag.length <= 6 && diag.filter(p => p.x1 === p.x2 || p.y1 === p.y2).length <= 1, `the diagonal is ${diag.length} slanting lines, not stairs (no small steps across)`);
// 8. turning the drawing: windows stay lying, names upright above their stations
context.turned = JSON.parse(JSON.stringify(parts));
const t2 = run2("rotateLine(turned)");
const w2 = t2.filter(p => p.t === "W");
assert.ok(w2.length === of("W").length && w2.every(w => Math.abs(w.x2 - w.x1) > Math.abs(w.y2 - w.y1)), "the windows stay lying after turning");
for (const nm of t2.filter(p => p.t === "N")) {
	const st = t2.filter(p => (p.t === "B" || p.t === "H") && p.s === nm.s);
	if (st.length) assert.ok(nm.y1 <= Math.min(...st.flatMap(p => [p.y1, p.y2])), `the name ${decodeURIComponent(nm.s)} above its station after turning`);
}
const tt = t2.filter(p => p.t === "T"), t0 = of("T");
assert.ok(Math.max(...tt.flatMap(p => [p.y1, p.y2])) - Math.min(...tt.flatMap(p => [p.y1, p.y2])) === Math.max(...t0.flatMap(p => [p.x1, p.x2])) - Math.min(...t0.flatMap(p => [p.x1, p.x2])), "turned a quarter: the width became the height");

// 9. review 2026-11-02: a single track with signals of both ways at the ends of a block; a long straight; a very large
// network; a dangerous expression
{
	const single = new Map();
	const add = (x, y, r, extra = {}) => single.set(x + "," + y, Object.assign({ p: [x, y, 0], r }, extra));
	for (let x = 0; x <= 100; x++) add(x, 5, (x > 0 ? 8 : 0) | (x < 100 ? 2 : 0));
	single.get("12,5").s = { dir: 2, aspect: "red", name: "閉塞" };
	single.get("86,5").s = { dir: 8, aspect: "red", name: "閉塞" };
	context.single = { tiles: [...single.values()], convoys: [] };
	run("var sp = makeLineDraft(single);");
	const sw = run2("sp.filter(p => p.t === 'W' && p.b.some(t => t[0] === 50)).map(p => p.f)");
	assert.ok(sw.length === 1 && sw[0] === 0, `single track: the window between signals of both ways shows both ways (f ${JSON.stringify(sw)})`);
	context.single.convoys = [train(7, [[50, 5, 0], [51, 5, 0]], 8, "西行"), train(8, [[30, 5, 0], [29, 5, 0]], 2, "東行")];
	const sp = run2("[...lineTrainPlaces(sp, single, label)].map(([i, l]) => l.number)");
	assert.ok(sp.includes("西行") || sp.includes("東行"), `a train of either way shows in it (${sp.join(", ")})`);
	// a straight of 600 tiles without a node: cut into lines of at most 200 tiles
	const long = [];
	for (let x = 0; x <= 600; x++) long.push({ p: [x, 3, 0], r: (x > 0 ? 8 : 0) | (x < 600 ? 2 : 0) });
	context.long = { tiles: long, convoys: [] };
	const ln = run2("makeLineDraft(long).filter(p => p.t === 'T').map(p => p.b.length)");
	assert.ok(ln.length >= 3 && ln.every(n => n <= 201) && ln.reduce((a, b) => a + b, 0) >= 601, `a long straight cut into ${ln.length} lines of at most 200 tiles`);
	// 150,000 tiles: no "Maximum call stack size exceeded" (Math.min(...))
	const big = [];
	for (let y = 0; y < 150; y++) for (let x = 0; x < 1000; x++) big.push({ p: [x, y * 3, 0], r: (x > 0 ? 8 : 0) | (x < 999 ? 2 : 0) });
	context.big = { tiles: big, convoys: [] };
	const t0 = Date.now();
	assert.ok(run("makeLineDraft(big).length") > 150, "a network of 150,000 tiles is drafted");
	console.log(`  (150,000 tiles drafted in ${Date.now() - t0} ms)`);
	// a repeated group in an expression of the colour rules: not used (it could take for ever)
	run(`var bad = lineRules([{ t: "Y", x1: 0, y1: 0, x2: 0, y2: 0, b: [], f: 0, s: encodeURIComponent(JSON.stringify({ rules: [{ k: "number", v: "(a+)+$", c: "#123456" }] })) }]);`);
	const t1 = Date.now();
	assert.equal(run(`lineNumberColor(bad, { number: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", cars: 0 })`), "#ffb31a", "a repeated group (a+)+ is not used");
	assert.ok(Date.now() - t1 < 100, "and does not take long");
}

if (process.argv[2]) {
	// the draft drawn roughly, to look at
	const S = 10, mx = Math.max(...parts.flatMap(p => [p.x1, p.x2])) + 20, my = Math.max(...parts.flatMap(p => [p.y1, p.y2])) + 6;
	const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${mx * S}" height="${my * S}"><rect width="100%" height="100%" fill="#0a2fb0"/>`];
	for (const p of parts) {
		const r = `x="${Math.min(p.x1, p.x2) * S}" y="${Math.min(p.y1, p.y2) * S}" width="${Math.max(2, Math.abs(p.x2 - p.x1) * S)}" height="${Math.max(2, Math.abs(p.y2 - p.y1) * S)}"`;
		if (p.t === "T") out.push(`<line x1="${p.x1 * S}" y1="${p.y1 * S}" x2="${p.x2 * S}" y2="${p.y2 * S}" stroke="#eef3ff" stroke-width="3"/>`);
		else if (p.t === "W" || p.t === "B") out.push(`<rect ${r} fill="#0b2c99" stroke="#5d82ff"/>`);
		else if (p.t === "H") out.push(`<rect ${r} fill="#38c8ff"/>`);
		else if (p.t === "N") out.push(`<text x="${p.x1 * S}" y="${p.y1 * S}" fill="#fff" font-size="${p.f & 1 ? 10 : 14}" text-anchor="middle">${name(p)}</text>`);
	}
	fs.writeFileSync(process.argv[2], out.join("") + "</svg>");
}
console.log(`PASS: line panel draft: shortened, stations (boxes / platform marks / names), windows by side and direction, branch, clock; blocks, train numbers in windows / boxes by direction, routes, colour rules, a diagonal as one line, turning, single track, long lines cut, very large network, unsafe expressions (${parts.length} parts)`);
