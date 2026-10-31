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
	const localStore = () => null; let networkMapZoom = 1, network = null, status = { lines: [] };`);
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
console.log(`PASS: line panel draft: shortened, stations (boxes / platform marks / names), windows by side and direction, branch, clock (${parts.length} parts)`);
