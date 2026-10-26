#!/usr/bin/env python3
"""
A two-way signal (両方向信号) registered as a lever signal (scenario il-test).

S1 (3,5) is made a signal for both directions. Its routes lead east (to platform A1). A train that
passes S1 westbound (from A1 back west) is not the business of these routes:
  1. no route set: the westbound train is not held at S1 for ever
  2. the route S1 -> A1 set for another train: the westbound train is not let into it (which would
     turn it back east into the station); the route stays set
  3. routes from S1 both ways: a train of either direction waits for a route of its own direction
  4. the directions told by the panel (sig_dir): with west handled the westbound train waits even with no route

Usage: two_way_test.py --sim build/default/sim --workdir <dir>
"""
import argparse, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_test import Panel, check, start_game, wait_until, simple_tool_id, PORT
from rescan_test import general_tool_id


def run(args):
    game = start_game(args, ["-scenario", "il-test"])
    try:
        p = Panel(PORT)
        sigs = lambda: p.request("signals 0 0 15 15")["signals"]
        wait_until(lambda: any(s["pos"] == [3, 5, 0] for s in sigs()), 60, "layout")
        time.sleep(2)
        s1 = next(s for s in sigs() if s["pos"] == [3, 5, 0])
        # building the same signal again on its tile turns it; one of the turns is "both directions"
        for _ in range(4):
            if next(s for s in sigs() if s["pos"] == [3, 5, 0])["dir"] == 10:
                break
            p.request(f"debug_work {general_tool_id('TOOL_BUILD_ROADSIGN')} 3,5,0 {s1['name']}")
            time.sleep(0.5)
        check(next(s for s in sigs() if s["pos"] == [3, 5, 0])["dir"] == 10, "S1 is a signal for both directions (east and west)")

        check(p.cmd("st_new,A")["ok"], "station")
        sid = p.status()["stations"][0]["id"]
        check(p.cmd(f"sig_add,{sid},3,5,0")["ok"] and p.cmd(f"st_mode,{sid},1")["ok"], "S1 registered, operator mode")
        home = ";".join(f"{x}:5:0" for x in range(3, 9))
        check(p.cmd(f"rt_path,{sid},{home},home")["ok"], "route S1 -> A1 (eastbound)")
        rid = p.status()["routes"][0]["id"]

        cid = p.request("debug_convoys")["convoys"][0]["id"]
        # A1 (7,5), then back west to (2,5): on the way back the train passes S1 westbound
        sched = "0|0|0|2|0|7,5,0,0,0,0,0,0,0,0,0,100,0,0|2,5,0,0,0,0,0,0,0,0,0,100,0,0|"
        p.request(f"debug_tool {simple_tool_id('TOOL_CHANGE_CONVOI')} g,{cid},{sched}")
        time.sleep(1)
        check(p.cmd(f"set,{rid}")["ok"], "route set for the train coming from the depot")
        p.request(f"debug_tool {simple_tool_id('TOOL_CHANGE_DEPOT')} b,1,5,0,{cid}")
        cnv = lambda: p.request("debug_convoys")["convoys"][0]
        wait_until(lambda: cnv()["pos"][0] >= 6, 60, "train at A1")
        check(True, "the train entered A1 by the route")
        wait_until(lambda: next(r for r in p.status()["routes"] if r["id"] == rid)["state"] == "idle", 60, "route released")

        print("[1] no route set: the westbound train passes S1")
        wait_until(lambda: cnv()["pos"][0] <= 2, 90, "train west of S1")
        check(True, "the train passed S1 westbound and reached (2,5)")

        print("[2] the route set for another train: the westbound train is not let into it")
        wait_until(lambda: next(r for r in p.status()["routes"] if r["id"] == rid)["state"] == "idle", 30, "route idle")
        check(p.cmd(f"set,{rid}")["ok"], "route set for the train going east again")
        wait_until(lambda: cnv()["pos"][0] >= 6, 90, "train back at A1")
        wait_until(lambda: next(r for r in p.status()["routes"] if r["id"] == rid)["state"] == "idle", 60, "route released")
        time.sleep(1)
        # a short route from S1 eastwards (as for a shunting move up to the platform), set while the train stands at A1
        check(p.cmd(f"rt_path,{sid},3:5:0;4:5:0;5:5:0,short")["ok"], "route S1 -> (5,5)")
        rid2 = next(r for r in p.status()["routes"] if r["name"] == "short")["id"]
        r = p.cmd(f"set,{rid2}")
        check(r["ok"], f"it is set while the train stands at A1 ({r.get('error')})")
        seen = set()
        def west():
            c = cnv()
            seen.add(next(r for r in p.status()["routes"] if r["id"] == rid2)["state"])
            return c["pos"][0] <= 2
        wait_until(west, 90, "train west of S1 again")
        check(seen == {"set"}, f"the route stayed set, the westbound train never took it ({sorted(seen)})")
        check(p.cmd(f"cancel,{rid2}")["ok"], "cancelled")

        def stays(cond, secs):
            end = time.time() + secs
            while time.time() < end:
                if not cond(cnv()):
                    return False
                time.sleep(0.3)
            return True

        print("[3] routes from S1 both ways: each direction waits for its own route")
        west = ";".join(f"{x}:5:0" for x in (3, 2))
        check(p.cmd(f"rt_path,{sid},{west},west")["ok"], "route S1 -> (2,5) (westbound) as well")
        rid3 = next(r for r in p.status()["routes"] if r["name"] == "west")["id"]
        # the train now comes back east from (2,5): with no eastbound route set it waits at S1
        check(stays(lambda c: c["pos"][0] <= 3, 12), "eastbound train waits at S1 (the westbound route does not let it pass)")
        check(p.cmd(f"set,{rid}")["ok"], "eastbound route set")
        wait_until(lambda: cnv()["pos"][0] >= 6, 90, "train at A1 again")
        wait_until(lambda: next(r for r in p.status()["routes"] if r["id"] == rid)["state"] == "idle", 60, "route released")
        time.sleep(3)
        check(stays(lambda c: c["pos"][0] >= 4, 15), "westbound train waits at S1 for the westbound route")
        check(p.cmd(f"set,{rid3}")["ok"], "westbound route set")
        wait_until(lambda: cnv()["pos"][0] <= 2, 90, "train west of S1 by the westbound route")
        check(True, "the westbound train took its own route")
        wait_until(lambda: next(r for r in p.status()["routes"] if r["id"] == rid3)["state"] == "idle", 60, "westbound route released")
        check(p.cmd(f"rt_del,{rid3}")["ok"], "westbound route deleted again")

        print("[4] directions told by the panel (sig_dir), no westbound route")
        check(p.cmd(f"sig_dir,{sid},3,5,0,10")["ok"], "S1 handles east and west")
        check(next(s for s in p.status()["stations"][0]["signals"] if s["pos"] == [3, 5, 0]).get("hd") == 10, "the status shows it")
        check(p.cmd(f"set,{rid}")["ok"], "eastbound route set")
        wait_until(lambda: cnv()["pos"][0] >= 6, 90, "train at A1 again")
        wait_until(lambda: next(r for r in p.status()["routes"] if r["id"] == rid)["state"] == "idle", 60, "route released")
        time.sleep(3)
        check(stays(lambda c: c["pos"][0] >= 4, 15), "westbound train waits at S1 (west is handled, no route)")
        check(p.cmd(f"sig_dir,{sid},3,5,0,2")["ok"], "S1 handles east only")
        wait_until(lambda: cnv()["pos"][0] <= 2, 90, "train west of S1")
        check(True, "the westbound train passes once west is not handled")
        check(not p.cmd(f"sig_dir,{sid},3,5,0,16")["ok"] and not p.cmd(f"sig_dir,{sid},9,9,0,2")["ok"], "bad direction / unregistered signal rejected")
        hd = lambda: next(s for s in p.status()["stations"][0]["signals"] if s["pos"] == [3, 5, 0]).get("hd")
        check(p.cmd(f"st_rescan,{sid}")["ok"] and hd() is None, "re-reading the track forgets the directions (the panel works them out again)")
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()
    print("TWO-WAY SIGNAL TEST DONE")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", required=True)
    ap.add_argument("--workdir", required=True)
    try:
        run(ap.parse_args())
    except AssertionError as e:
        print("TEST FAILED:", e)
        sys.exit(1)
