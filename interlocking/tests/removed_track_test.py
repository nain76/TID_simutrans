#!/usr/bin/env python3
"""
A route set, then a piece of its track removed in the game (scenario il-test).

The train that comes to the signal must not be let into the gap: the route is taken back
(the panel is told), the signal stays at danger and the train waits.

Usage: removed_track_test.py --sim build/default/sim --workdir <dir>
"""
import argparse, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_test import Panel, check, start_game, wait_until, simple_tool_id, PORT
from rescan_test import general_tool_id


def run(args):
    game = start_game(args, ["-scenario", "il-test"])
    try:
        p = Panel(PORT)
        wait_until(lambda: any(s["pos"] == [3, 5, 0] for s in p.request("signals 0 0 15 15")["signals"]), 60, "layout")
        time.sleep(2)
        check(p.cmd("st_new,A")["ok"], "station")
        sid = p.status()["stations"][0]["id"]
        check(p.cmd(f"sig_add,{sid},3,5,0")["ok"] and p.cmd(f"st_mode,{sid},1")["ok"], "S1 registered, operator mode")
        check(p.cmd(f"rt_path,{sid},{';'.join(f'{x}:5:0' for x in range(3, 9))},home")["ok"], "route S1 -> A1")
        rid = p.status()["routes"][0]["id"]
        check(p.cmd(f"set,{rid}")["ok"], "route set")
        r = p.request(f"debug_work {general_tool_id('TOOL_REMOVER')} 5,5,0")
        check(r.get("ok"), f"the track at (5,5) on the route removed ({r})")

        cid = p.request("debug_convoys")["convoys"][0]["id"]
        sched = "0|0|0|2|0|7,5,0,0,0,0,0,0,0,0,0,100,0,0|2,5,0,0,0,0,0,0,0,0,0,100,0,0|"
        p.request(f"debug_tool {simple_tool_id('TOOL_CHANGE_CONVOI')} g,{cid},{sched}")
        time.sleep(1)
        p.request(f"debug_tool {simple_tool_id('TOOL_CHANGE_DEPOT')} b,1,5,0,{cid}")
        ev = p.wait_event(lambda e: e["type"] == "broken", 60)
        check(ev["id"] == rid, f"the panel is told the route is broken ({ev})")
        time.sleep(5)
        cnv = p.request("debug_convoys")["convoys"][0]
        route = next(r for r in p.status()["routes"] if r["id"] == rid)
        sig = next(s for s in p.status()["stations"][0]["signals"] if s["pos"] == [3, 5, 0])
        check(route["state"] == "idle" and sig["aspect"] == "red" and cnv["pos"][0] <= 3,
              f"the route is taken back, S1 stays at danger, the train waits (route {route['state']}, S1 {sig['aspect']}, train at {cnv['pos']})")
        r = p.cmd(f"set,{rid}")
        check(not r["ok"], f"it cannot be set again while the track is missing ({r.get('error')})")
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()
    print("REMOVED TRACK TEST DONE")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", required=True)
    ap.add_argument("--workdir", required=True)
    try:
        run(ap.parse_args())
    except AssertionError as e:
        print("TEST FAILED:", e)
        sys.exit(1)
