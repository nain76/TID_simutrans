// Web panel: line panels (路線盤) with trains running (scenario il-test)
//   1. a route set on the station's panel is drawn red on the line panel
//   2. a train out of the depot: its block red, its number in a window or a number box; its details on a click,
//      a train number given by hand (red) and taken back
//   3. a line panel shown asks the game for the trains only (tiles=0); the tiles again when the tracks change
//
//   node interlocking/tests/panel_line_run_test.mjs <sim binary> <workdir> <screenshot dir>
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
const PORT = 13364, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cmd = (c) => fetch(BASE + "/api/cmd", { method: "POST", headers: { "X-IL-Panel": "1" }, body: c });
const st = async () => (await (await fetch(BASE + "/api/status")).json());
const waitFor = async (fn, ms, text) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(300); } throw new Error("timeout: " + text); };
// the line protocol of the bridge (debug commands): one line out, the first answer back
const line = (l) => new Promise((res, rej) => {
	const s = net.connect(PORT, "127.0.0.1", () => s.write(l + "\n"));
	let buf = "";
	s.on("data", d => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { s.destroy(); try { res(JSON.parse(buf.slice(0, i))); } catch (e) { rej(e); } } });
	s.on("error", rej);
	setTimeout(() => { s.destroy(); res(null); }, 5000);
});
const text = fs.readFileSync("simmenu.h", "utf8"), block = text.slice(text.indexOf("TOOL_PAUSE = 0"), text.indexOf("SIMPLE_TOOL_COUNT"));
const simpleTool = (name) => [...block.matchAll(/^\s*(\w+)\s*(?:=\s*0)?\s*,/gm)].map(m => m[1]).indexOf(name);

const game = spawn(path.resolve(sim), ["-set_workdir", workdir, "-singleuser", "-objects", "pak64/", "-lang", "en", "-nosound", "-nomidi", "-fps", "25", "-scenario", "il-test"],
	{ cwd: workdir, env: { ...process.env, TID_IL_PORT: String(PORT), TID_IL_DEBUG: "1", TID_IL_PANEL_DIR: path.resolve("interlocking/panel") }, stdio: "ignore" });
let browser;
try {
	for (let i = 0; i < 120; i++) { try { await fetch(BASE + "/api/info"); break; } catch (e) { await sleep(500); } }
	await sleep(4000);
	await cmd("st_newh,7:5:0,A"); await sleep(800);
	const sid = (await st()).stations[0].id;
	for (const c of [`sig_add,${sid},3,5,0`, `st_mode,${sid},1`, `rt_path,${sid},3:5:0;4:5:0;5:5:0;6:5:0;7:5:0;8:5:0,home`]) { await cmd(c); await sleep(600); }
	browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	page.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failed = true; });
	const asked = [];
	page.on("request", r => { if (r.url().includes("/api/network")) asked.push(r.url()); });
	await page.addInitScript(() => localStorage.setItem("tidil.panelMode", "network"));
	await page.goto(BASE + "/");
	await page.waitForSelector("#conndot.ok");
	await page.evaluate(() => { const h = halts.find(x => x.tiles.some(t => t.join(",") === "7,5,0")); setArea(station().id, Object.assign(boxAround(h.tiles.concat([[1, 5, 0], [14, 5, 0]]), 2), { halt: h.id })); });
	await page.waitForFunction(() => network && network.tiles && network.tiles.length > 5, null, { timeout: 15000 });
	page.once("dialog", d => d.accept("試験線"));
	await page.click("#lineBar button[data-ln=new]");
	await page.click("#lineBar button[data-ln=pickall]");
	await page.waitForFunction(() => lnEdit && lnEdit.parts.length > 0, null, { timeout: 10000 });
	await page.click("#lineBar button[data-ln=apply]");
	await page.waitForFunction(() => !lnEdit && document.querySelectorAll("#lineMap line").length > 3, null, { timeout: 10000 });

	console.log("[1] a route of the station's panel");
	const rid = (await st()).routes.find(r => r.name === "home").id;
	await cmd(`set,${rid}`);
	await page.waitForFunction(() => document.querySelectorAll("#lineMap .lnroute").length > 0, null, { timeout: 8000 });
	check(true, "the route set is drawn on the line panel");
	if (shots) await page.screenshot({ path: path.join(shots, "line_run_1_route.png") });

	console.log("[2] a train out of the depot");
	const cid = (await line("debug_convoys")).convoys[0].id;
	const sched = "0|0|0|2|0|7,5,0,0,0,0,0,0,0,0,0,100,0,0|14,5,0,0,0,0,0,0,0,0,0,100,0,0|";
	await line(`debug_tool ${simpleTool("TOOL_CHANGE_CONVOI")} g,${cid},${sched}`);
	await sleep(1000);
	await line(`debug_tool ${simpleTool("TOOL_CHANGE_DEPOT")} b,1,5,0,${cid}`);
	await page.waitForFunction(() => document.querySelectorAll("#lineMap .train").length > 0, null, { timeout: 60000 });
	const number = await page.evaluate(() => operationNumber(network.convoys[0].name));
	const name = await page.evaluate(() => network.convoys[0].name);
	const shown = await page.$$eval("#lineMap .train text", ts => ts.map(t => t.textContent));
	check(shown.includes(number), `the train's number is shown in a window or a box (${shown.join(" / ")}; expected ${number})`);
	check(await page.$$eval("#lineMap line", ls => ls.some(l => l.getAttribute("stroke") === "#ff3b30" && !l.classList.contains("lnroute"))), "its block is red");
	if (shots) await page.screenshot({ path: path.join(shots, "line_run_2_train.png") });
	// it reaches the platform of A: the number box of that track
	await page.waitForFunction(() => [...document.querySelectorAll("#lineMap .train")].some(g => lnPartsShown()[Number(g.dataset.lnpart)]?.t === "B"), null, { timeout: 90000 }).catch(() => {});
	check(await page.evaluate(() => [...document.querySelectorAll("#lineMap .train")].some(g => lnPartsShown()[Number(g.dataset.lnpart)]?.t === "B")), "at the station: in the number box of its track");
	if (shots) await page.screenshot({ path: path.join(shots, "line_run_3_station.png") });

	// what the windows show: the name of the train, of its schedule (none here: the operation number), the train number
	await page.selectOption("#lineBar select[data-ln=label]", "name");
	await page.waitForFunction((n) => [...document.querySelectorAll("#lineMap .train text")].some(t => t.textContent === n), name, { timeout: 8000 });
	check(true, "編成名表示: the name of the train");
	await page.selectOption("#lineBar select[data-ln=label]", "number");
	await page.waitForFunction((n) => [...document.querySelectorAll("#lineMap .train text")].some(t => t.textContent === n), number, { timeout: 8000 });
	check(true, "列番表示 again");

	console.log("[2b] the details of a train, numbers given by hand");
	await page.locator("#lineMap .train text").first().click();
	await page.waitForSelector("#lnModal:not([hidden]) .lnhead");
	const head = await page.textContent("#lnModal .lnhead b");
	check(head.includes(number), `the details open on a click (${head})`);
	check((await page.textContent("#lnModal .lnbox")).includes("両編成"), "with the number of cars");
	await page.fill("#lnModal [data-x=num]", "201T");
	await page.check("#lnModal [data-x=red]");
	await page.click("#lnModal [data-x=save]");
	await waitFor(async () => JSON.stringify((await st()).train_tags) === JSON.stringify([[name, "", "201T", 1]]), 8000, "tag saved");
	check(true, "given by hand: saved in the game by the name of the train");
	await page.waitForFunction(() => [...document.querySelectorAll("#lineMap .train text")].some(t => t.textContent === "201T" && t.getAttribute("fill") === "#ff4040"), null, { timeout: 8000 });
	check(true, "shown as given, in red (special train number)");
	if (shots) await page.screenshot({ path: path.join(shots, "line_run_2b_given.png") });
	await page.locator("#lineMap .train text").first().click();
	await page.waitForSelector("#lnModal:not([hidden]) [data-x=clear]:not([disabled])");
	await page.click("#lnModal [data-x=clear]");
	await waitFor(async () => !(await st()).train_tags.length, 8000, "tag removed");
	await page.waitForFunction((n) => [...document.querySelectorAll("#lineMap .train text")].some(t => t.textContent === n), number, { timeout: 8000 });
	check(true, "元に戻す: the number of the game again");

	console.log("[3] the trains only");
	const later = asked.slice(-5);
	check(later.length >= 3 && later.every(u => u.includes("tiles=0")), `a line panel shown: the game is asked for the trains only (${later.length} asked)`);
	// the tracks change (a signal turned): the tiles are asked for again
	const n0 = asked.length;
	const sname = await page.evaluate(() => network.tiles.find(t => t.s)?.s.name);
	const gtext = text.slice(text.indexOf("TOOL_QUERY=0"), text.indexOf("GENERAL_TOOL_COUNT"));
	const general = [...("\t" + gtext).matchAll(/^\s*(\w+)\s*(?:=\s*0)?\s*,/gm)].map(m => m[1]).indexOf("TOOL_BUILD_ROADSIGN");
	await line(`debug_work ${general} 3,5,0 ${sname}`);
	await waitFor(async () => asked.slice(n0).some(u => !u.includes("tiles=0")), 15000, "tiles asked again");
	check(true, "the tracks changed: the tiles are asked for again");
} catch (e) { console.log("ERROR", e); failed = true; }
finally { if (browser) await browser.close(); game.kill(); }
console.log(failed ? "TEST FAILED" : "ALL LINE PANEL RUN TESTS PASSED");
process.exit(failed ? 1 : 0);
