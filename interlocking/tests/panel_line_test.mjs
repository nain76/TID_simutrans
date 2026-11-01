// Web panel: line panels (路線盤) in the view of all trains (全区間在線), scenario il-via
//   0. the range of a new line panel dragged on the map: the draft has only the tracks in it
//   1. a line panel made from a draft of the tracks: lines, a station, train number windows, the clock; turning,
//      choosing several parts with a rectangle
//   2. applied: in the game, shown to a second browser (drawn in blue)
//   3. edited: a part moved and applied; colour rules; renamed; deleted
//
//   node interlocking/tests/panel_line_test.mjs <sim binary> <workdir> <screenshot dir>
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch (e) { playwright = require(path.join(process.env.NODE_PATH || "/usr/local/lib/node_modules", "playwright")); }
let failed = false;
const check = (c, t) => { console.log((c ? "  OK   " : "  FAIL ") + t); if (!c) failed = true; };
const [sim, workdir, shots] = process.argv.slice(2);
const PORT = 13363, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cmd = (c) => fetch(BASE + "/api/cmd", { method: "POST", headers: { "X-IL-Panel": "1" }, body: c });
const st = async () => (await (await fetch(BASE + "/api/status")).json());
const line = async (id) => (await (await fetch(BASE + "/api/line?id=" + id)).json());
const waitFor = async (fn, ms, text) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(300); } throw new Error("timeout: " + text); };
const game = spawn(path.resolve(sim), ["-set_workdir", workdir, "-singleuser", "-objects", "pak64/", "-lang", "en", "-nosound", "-nomidi", "-fps", "25", "-scenario", "il-via"],
	{ cwd: workdir, env: { ...process.env, TID_IL_PORT: String(PORT), TID_IL_DEBUG: "1", TID_IL_PANEL_DIR: path.resolve("interlocking/panel") }, stdio: "ignore" });
let browser;
try {
	for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/api/info"); break; } catch (e) { await sleep(500); } }
	await sleep(4000);
	await cmd("st_newh,13:5:0,V"); await sleep(800);
	browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
	const open = async () => {
		const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
		page.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failed = true; });
		await page.addInitScript(() => localStorage.setItem("tidil.panelMode", "network"));
		await page.goto(BASE + "/");
		await page.waitForSelector("#conndot.ok");
		return page;
	};
	const page = await open();
	await page.evaluate(() => { const h = halts.find(x => x.tiles.some(t => t.join(",") === "13,5,0")); setArea(station().id, Object.assign(boxAround(h.tiles.concat([[3, 5, 0], [4, 7, 0]]), 2), { halt: h.id })); });
	await page.waitForFunction(() => network && network.tiles && network.tiles.length > 10, null, { timeout: 15000 });

	console.log("[0] the range of a line panel chosen on the map");
	page.once("dialog", d => d.accept("範囲"));
	await page.click("#lineBar button[data-ln=new]");
	await page.waitForSelector("#lineBar button[data-ln=pickall]");
	check(await page.locator("#networkMapWrap").isVisible(), "the map is shown to choose the range on");
	// drag over the tiles x 2..9, y 4..6 (the main track west of the platform, not the loop below)
	const screen = (x, y) => page.evaluate(([x, y]) => { const m = networkMapRendered, svg = document.getElementById("networkMap"), pt = svg.createSVGPoint();
		pt.x = (x - m.x1 + 1.5) * m.unit; pt.y = (y - m.y1 + 1.5) * m.unit; const q = pt.matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; }, [x, y]);
	const [ax, ay] = await screen(1.6, 4.4), [bx, by] = await screen(9.4, 5.6);
	await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move((ax + bx) / 2, (ay + by) / 2); await page.mouse.move(bx, by); await page.mouse.up();
	await page.waitForFunction(() => lnEdit && lnEdit.parts.length > 0, null, { timeout: 10000 });
	const inRange = await page.evaluate(() => lnEdit.parts.filter(p => p.t === "T").flatMap(p => p.b).every(t => t[0] >= 2 && t[0] <= 9 && t[1] >= 4 && t[1] <= 6));
	check(inRange && await page.evaluate(() => lnEdit.parts.some(p => p.t === "T")), "the draft has only the tracks in the range");
	page.once("dialog", d => d.accept());
	await page.click("#lineBar button[data-ln=cancel]");
	await cmd(`ln_del,${(await st()).lines[0].id}`);
	await waitFor(async () => !(await st()).lines.length, 5000, "range test panel removed");

	console.log("[1] a line panel from a draft of the tracks");
	page.once("dialog", d => d.accept("京王線"));
	await page.click("#lineBar button[data-ln=new]");
	await page.click("#lineBar button[data-ln=pickall]");
	await page.waitForFunction(() => lnEdit && lnEdit.parts.length > 0, null, { timeout: 10000 });
	const types = await page.evaluate(() => lnEdit.parts.map(p => p.t));
	const count = (t) => types.filter(x => x === t).length;
	check(count("T") >= 4 && count("C") === 1 && (count("B") + count("H")) >= 1 && count("N") >= 1, `the draft: lines ${count("T")}, station ${count("B")} boxes / ${count("H")} platforms, names ${count("N")}, clock`);
	check(await page.evaluate(() => lnEdit.parts.filter(p => p.t === "T").every(p => p.b.length >= 2)), "every line stands for track tiles");
	const loopTiles = await page.evaluate(() => lnEdit.parts.filter(p => p.t === "T").flatMap(p => p.b.map(t => t.join(","))));
	check(loopTiles.includes("7,7,0") && loopTiles.includes("7,5,0"), "both the main track and the loop are drawn");
	check(await page.evaluate(() => { const ts = lnEdit.parts.filter(p => p.t === "T"); return Math.max(...ts.flatMap(p => [p.x1, p.x2])) - Math.min(...ts.flatMap(p => [p.x1, p.x2])); }) < 2 * 16,
		"long plain stretches are shortened");
	check(await page.locator("#lineMap line").count() > 4 && await page.locator("#lineWrap").isVisible() && !(await page.locator("#networkMapWrap").isVisible()), "the draft is drawn instead of the map");
	// choose several parts with a rectangle, turn the drawing and back (four turns), undo the deletion of the chosen ones
	const before = await page.evaluate(() => JSON.stringify(lnEdit.parts.filter(p => p.t === "T").map(p => p.b)));
	await page.click("#lineBar button[data-ln=rotate]");
	const turned = await page.evaluate(() => lnEdit.parts.filter(p => p.t === "W").every(w => Math.abs(w.x2 - w.x1) > Math.abs(w.y2 - w.y1)));
	for (let i = 0; i < 3; i++) await page.click("#lineBar button[data-ln=rotate]");
	check(turned && await page.evaluate(() => JSON.stringify(lnEdit.parts.filter(p => p.t === "T").map(p => p.b))) === before, "回転: windows stay lying; four turns keep every line and its tiles");
	await page.click("#lineBar button[data-ln=tool][data-t=R]");
	const box = await page.locator("#lineMap").boundingBox();
	await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5); await page.mouse.up();
	const chosen = await page.evaluate(() => lnEdit.multi?.size || 0), all = await page.evaluate(() => lnEdit.parts.length);
	check(chosen >= all - 1, `範囲で選ぶ: the parts in the rectangle chosen (${chosen} of ${all})`);
	await page.keyboard.press("Delete");
	check(await page.evaluate(() => lnEdit.parts.length) === all - chosen, "deleted together");
	await page.keyboard.press("Control+z");
	check(await page.evaluate(() => lnEdit.parts.length) === all, "and back (Ctrl+Z)");
	if (shots) await page.screenshot({ path: path.join(shots, "line_1_draft.png") });

	console.log("[2] applied");
	await page.click("#lineBar button[data-ln=apply]");
	await waitFor(async () => (await st()).lines?.[0]?.parts > 0, 10000, "saved");
	const s = await st();
	const lid = s.lines[0].id;
	check(s.lines.length === 1 && decodeURIComponent(s.lines[0].name) === "京王線" && s.lines[0].parts === types.length, `in the game: 「京王線」 with ${s.lines[0].parts} parts`);
	await page.waitForFunction(() => !lnEdit, null, { timeout: 10000 });
	check(true, "editing ended");
	const page2 = await open();
	await page2.evaluate(() => { const h = halts.find(x => x.tiles.some(t => t.join(",") === "13,5,0")); setArea(station().id, Object.assign(boxAround(h.tiles.concat([[3, 5, 0], [4, 7, 0]]), 2), { halt: h.id })); });
	await page2.waitForSelector("#lineBar button[data-ln=view][data-id='" + lid + "']");
	await page2.click("#lineBar button[data-ln=view][data-id='" + lid + "']");
	await page2.waitForFunction(() => document.querySelectorAll("#lineMap line").length > 4, null, { timeout: 10000 });
	check(await page2.locator("#lineMap text").filter({ hasText: "land stop" }).count() >= 1, "a second browser shows it, with the station name");
	check((await page2.getAttribute("#lineMap rect", "fill")) === "url(#lineBg)", "drawn in blue like the TID");
	if (shots) await page2.screenshot({ path: path.join(shots, "line_2_shown.png") });

	console.log("[3] edit, rename, delete");
	await page.click("#lineBar button[data-ln=edit]");
	await page.waitForFunction(() => !!lnEdit, null, { timeout: 5000 });
	const n = await page.evaluate(() => { const i = lnEdit.parts.findIndex(p => p.t === "N"); lnEdit.sel = i; renderNetwork(); return [i, lnEdit.parts[i].x1]; });
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	check(await page.evaluate(([i, x]) => lnEdit.parts[i].x1 === x + 2, n), "a station name moved with the arrow keys");
	check((await st()).lines[0].editing !== undefined, "the others see it is being edited");
	await page.click("#lineBar button[data-ln=apply]");
	await waitFor(async () => (await line(lid)).parts[n[0]]?.x1 === n[1] + 2, 10000, "moved part saved");
	check(true, "applied: the game keeps the moved part");
	await page2.waitForFunction(([i, x]) => [...lineCache.values()][0]?.parts[i]?.x1 === x + 2, n, { timeout: 10000 });
	check(true, "the second browser fetched the new drawing");
	// colour rules of the train numbers: edited and kept with the line panel
	await page.click("#lineBar button[data-ln=edit]");
	await page.waitForFunction(() => !!lnEdit, null, { timeout: 5000 });
	await page.click("#lineBar button[data-ln=colors]");
	await page.click("#lnModal [data-x=add]");
	await page.fill("#lnModal [data-f=v]", "10");
	await page.click("#lnModal [data-x=ok]");
	await page.click("#lineBar button[data-ln=apply]");
	await waitFor(async () => (await line(lid)).parts.some(p => p.t === "Y" && JSON.parse(decodeURIComponent(p.s)).rules[0]?.v === "10"), 10000, "rules saved");
	check(true, "colour rules (10 cars) kept with the line panel");
	page.once("dialog", d => d.accept("井の頭線"));
	await page.click("#lineBar button[data-ln=rename]");
	await waitFor(async () => decodeURIComponent((await st()).lines[0].name) === "井の頭線", 8000, "renamed");
	check(true, "renamed");
	page.once("dialog", d => d.accept());
	await page.click("#lineBar button[data-ln=remove]");
	await waitFor(async () => !(await st()).lines.length, 8000, "deleted");
	await page.waitForFunction(() => document.getElementById("networkMapWrap").hidden === false, null, { timeout: 5000 });
	check(true, "deleted: the map is shown again");
} catch (e) { console.log("ERROR", e); failed = true; }
finally { if (browser) await browser.close(); game.kill(); }
console.log(failed ? "TEST FAILED" : "ALL LINE PANEL TESTS PASSED");
process.exit(failed ? 1 : 0);
