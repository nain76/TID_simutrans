// Web panel: via buttons (経由) on the il-via scenario: from S1 to the platform P straight along the main
// track, or round the loop when the loop is chosen as a via point. Electronic and relay panel.
// Then S1 is made a signal for both directions: the panel tells the game the direction it handles.
//
//   node interlocking/tests/panel_via_test.mjs <sim binary> <workdir> <screenshot dir>
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch (e) { playwright = require(path.join(process.env.NODE_PATH || "/usr/local/lib/node_modules", "playwright")); }
let failed = false;
const check = (c, t) => { console.log((c ? "  OK   " : "  FAIL ") + t); if (!c) failed = true; };
const [sim, workdir, shots] = process.argv.slice(2);
const PORT = 13362, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cmd = (c) => fetch(BASE + "/api/cmd", { method: "POST", headers: { "X-IL-Panel": "1" }, body: c });
const st = async () => (await (await fetch(BASE + "/api/status")).json());
const waitFor = async (fn, ms, text) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(300); } throw new Error("timeout: " + text); };
const game = spawn(path.resolve(sim), ["-set_workdir", workdir, "-singleuser", "-objects", "pak64/", "-lang", "en", "-nosound", "-nomidi", "-fps", "25", "-scenario", "il-via"],
	{ cwd: workdir, env: { ...process.env, TID_IL_PORT: String(PORT), TID_IL_DEBUG: "1", TID_IL_PANEL_DIR: path.resolve("interlocking/panel") }, stdio: "ignore" });
try {
	for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/api/info"); break; } catch (e) { await sleep(500); } }
	await sleep(4000);
	await cmd("st_newh,13:5:0,V"); await sleep(800);
	const sid = (await st()).stations[0].id;
	for (const c of [`sig_add,${sid},3,5,0`, `st_mode,${sid},1`]) { await cmd(c); await sleep(500); }
	const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	page.on("dialog", d => d.accept());
	page.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failed = true; });
	await page.goto(BASE + "/");
	await page.waitForSelector("#conndot.ok");
	await page.evaluate(() => { const h = halts.find(x => x.tiles.some(t => t.join(",") === "13,5,0")); setArea(station().id, Object.assign(boxAround(h.tiles.concat([[3, 5, 0], [4, 7, 0]]), 2), { halt: h.id })); });
	await sleep(1500);
	const s1 = () => page.locator("svg g.clickable", { has: page.locator("title", { hasText: "(3, 5, 0)" }) }).first();
	const dest = () => page.locator("svg g.clickable.dest").first();
	const routeTiles = async () => { const r = (await st()).routes.find(x => x.state !== "idle"); return r ? r.tiles.map(t => t.join(",")) : null; };

	console.log("[1] electronic: straight without a via point");
	await s1().click();
	await page.waitForSelector("svg g.via[data-via='4,6,0']", { state: "attached", timeout: 5000 });
	const cands = await page.$$eval("svg g.via", gs => gs.map(g => g.dataset.via));
	check(cands.includes("4,6,0") && cands.includes("5,5,0") && !cands.includes("3,5,0") && !cands.includes("2,5,0"), `via buttons where a route can go on to a destination, none on the start: ${cands.join(" / ")}`);
	await page.screenshot({ path: path.join(shots, "via_1.png") });
	await dest().click();
	await waitFor(async () => !!(await routeTiles()), 8000, "route set");
	const straight = await routeTiles();
	check(straight.includes("7,5,0") && !straight.includes("7,7,0"), `without a via point the route goes straight (${straight.join(" ")})`);
	await page.waitForFunction(() => status.routes.some(r => r.state === "set"), null, { timeout: 5000 });
	await s1().click();   // the lever again: cancels the route
	await waitFor(async () => !(await routeTiles()), 8000, "route cancelled");
	await page.waitForFunction(() => !status.routes.some(r => r.state === "set"), null, { timeout: 5000 });

	console.log("[2] electronic: round the loop with a via point");
	await s1().click();
	await page.click("svg g.via[data-via='4,6,0']");
	await page.waitForSelector("svg g.via.on[data-via='4,6,0']", { state: "attached", timeout: 5000 });
	check((await page.textContent("svg g.via.on[data-via='4,6,0'] text")) === "1", "the chosen via point is lit and numbered");
	await page.screenshot({ path: path.join(shots, "via_2.png") });
	await dest().click();
	await waitFor(async () => !!(await routeTiles()), 8000, "route set via the loop");
	const loop = await routeTiles();
	check(loop.includes("4,6,0") && loop.includes("7,7,0") && !loop.includes("7,5,0"), `with the via point the route goes round the loop (${loop.join(" ")})`);
	const r = (await st()).routes.find(x => x.state !== "idle");
	check(r.name.includes("経由"), `its name says so: ${r.name}`);
	check(await page.evaluate(() => routeVia.length === 0), "the via points are dropped once the route is set");
	await page.waitForFunction(() => status.routes.some(r => r.state === "set"), null, { timeout: 5000 });
	await s1().click();
	await waitFor(async () => !(await routeTiles()), 8000, "route cancelled");
	await page.waitForFunction(() => !status.routes.some(r => r.state === "set"), null, { timeout: 5000 });

	console.log("[3] a via point no route can pass, Esc");
	await s1().click();
	await page.evaluate(() => viaClicked([2, 5, 0]));   // behind S1: no way there
	check(await page.locator("svg g.clickable.dest.blink").count() === 0, "no destination is lit for an impossible via point");
	await page.keyboard.press("Escape");
	check(await page.evaluate(() => routeVia.length === 0 && !!nxStart), "Esc drops the via points (the start stays chosen)");
	await s1().click();

	console.log("[4] relay panel: lever, via point, destination");
	await cmd(`st_cfg,${sid},1,0,5,3,2`); await sleep(1200);
	await page.click("#relayBoard .rlever[data-sl='3,5,0'] [data-side=R]");
	await waitFor(async () => ((await st()).stations[0].slevers || []).some(l => l.pos.join(",") === "3,5,0"), 8000, "lever turned");
	await sleep(800);
	await page.click("svg g.via[data-via='4,6,0']");
	await page.waitForSelector("svg g.via.on[data-via='4,6,0']", { state: "attached", timeout: 5000 });
	await dest().click();
	await waitFor(async () => !!(await routeTiles()), 15000, "relay route set");
	const rl = await routeTiles();
	check(rl.includes("7,7,0") && !rl.includes("7,5,0"), `relay: the route goes round the loop (${rl.join(" ")})`);

	console.log("[5] custom panel: a track line as the via button");
	await cmd(`sl_turn,${sid},3,5,0,N`); await sleep(1200);
	await cmd(`st_cfg,${sid},0,0,5,3,2`); await sleep(1200);
	await page.click("#viewbar button[data-cp=edit]");
	await page.waitForSelector("#map [data-part]");
	await page.click("#viewbar button[data-cp=apply]");
	await waitFor(async () => (await st()).stations[0].parts > 0, 10000, "custom panel saved");
	await page.waitForFunction(() => !status.routes.some(r => r.state !== "idle"), null, { timeout: 10000 });
	await page.click("#map [data-part]:has(text:text-is('S1'))");
	await page.waitForSelector("#map g.via", { state: "attached", timeout: 5000 });
	const loopVia = await page.$$eval("#map g.via", gs => gs.map(g => g.dataset.via));
	const lv = loopVia.find(k => ["4,6,0", "4,7,0", "5,7,0", "6,7,0", "7,7,0", "8,7,0", "9,7,0", "10,7,0", "10,6,0"].includes(k));
	check(!!lv, `via buttons on the lines of the custom panel: ${loopVia.join(" / ")}`);
	await page.click(`#map g.via[data-via='${lv}']`);
	await page.waitForSelector("#map g.via.on", { state: "attached", timeout: 5000 });
	await page.screenshot({ path: path.join(shots, "via_custom.png") });
	await page.click("#map g.blink");
	await waitFor(async () => !!(await routeTiles()), 10000, "custom route set");
	const cr = await routeTiles();
	check(cr.includes("7,7,0") && !cr.includes("7,5,0"), `custom panel: the route goes round the loop (${cr.join(" ")})`);

	console.log("[6] S1 made a signal for both directions: the panel tells the game which way it leads trains");
	const text = fs.readFileSync("simmenu.h", "utf8"), block = text.slice(text.indexOf("TOOL_QUERY=0"), text.indexOf("GENERAL_TOOL_COUNT"));
	const tools = [...("\t" + block).matchAll(/^\s*(\w+)\s*(?:=\s*0)?\s*,/gm)].map(m => m[1]);
	const line = (l) => new Promise(res => { const s = net.connect(PORT, "127.0.0.1", () => { s.write(l + "\n"); setTimeout(() => { s.destroy(); res(); }, 600); }); });
	let sent = 0;
	page.on("request", r => { if (r.url().endsWith("/api/cmd") && (r.postData() || "").startsWith("sig_dir,")) sent++; });
	const sname = await page.evaluate(() => tileIndex.get("3,5,0").s.name);
	for (let i = 0; i < 4 && await page.evaluate(() => tileIndex.get("3,5,0").s.dir) !== 10; i++) {
		// building the same signal again on its tile turns it; one of the turns is "both directions"
		await line(`debug_work ${tools.indexOf("TOOL_BUILD_ROADSIGN")} 3,5,0 ${sname}`);
		await page.evaluate(() => refreshTracks().then(render)); await sleep(1500);
	}
	const hd = async () => (await st()).stations[0].signals.find(x => x.pos.join(",") === "3,5,0").hd;
	await waitFor(async () => (await hd()) !== undefined, 8000, "direction sent");
	check(await hd() === 2, `S1 leads trains east only (no destinations to the west): hd ${await hd()}`);
	await sleep(3000);
	const before = sent;
	check(before === 1, `sent once, not on every redraw (${before})`);
	await cmd(`st_rescan,${sid}`);
	await waitFor(async () => sent > before && (await hd()) === 2, 10000, "direction sent again after re-reading the track");
	check(true, "after re-reading the track the panel works the direction out again");
	await browser.close();
} catch (e) { console.log("ERROR", e); failed = true; } finally { game.kill(); }
console.log(failed ? "TEST FAILED" : "ALL VIA PANEL TESTS PASSED");
