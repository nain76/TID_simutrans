#!/usr/bin/env python3
"""
Line panels (路線盤) in the game (scenario il-test): the drawing of a whole line for the view of all trains.

  1. ln_new, upload in parts (ln_begin / ln_add / ln_end), the status and /api/line
  2. rename, editing notice, a part a line panel has no use for, an interrupted upload, the lowest free number
  3. turning the map: the tiles turn, the drawing stays
  4. saving and loading (also an upload interrupted by saving: a client joining in the middle of it)
  5. delete

Usage: line_test.py --sim build/default/sim --workdir <dir>
"""
import argparse, json, os, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_test import Panel, check, start_game, wait_until, simple_tool_id, PORT


def line(lid):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/line?id={lid}").read())


def run(args):
    game = start_game(args, ["-scenario", "il-test"])
    try:
        p = Panel(PORT)
        wait_until(lambda: any(s["pos"] == [3, 5, 0] for s in p.request("signals 0 0 15 15")["signals"]), 60, "layout")

        print("[1] a line panel")
        check(p.cmd("ln_new,%E4%BA%AC%E7%8E%8B%E7%B7%9A")["ok"], "ln_new (the name encoded by the panel)")
        lines = p.status()["lines"]
        check(len(lines) == 1 and lines[0]["name"] == "%E4%BA%AC%E7%8E%8B%E7%B7%9A" and lines[0]["parts"] == 0, f"in the status ({lines})")
        lid = lines[0]["id"]
        parts = ["T/2/2/20/2/0/3:5:0+4:5:0+5:5:0/", "W/8/0/14/1/2/4:5:0+5:5:0/", "B/16/1/22/3/0/7:5:0+8:5:0/",
                 "H/4/4/6/5/0/7:5:0/", "N/16/-2/22/-1/0//%E6%A1%9C", "L/1/1/1/1/0//abc", "F/0/0/30/8/1//", "C/30/0/30/0/0//"]
        check(p.cmd(f"ln_begin,{lid}")["ok"] and p.cmd(f"ln_add,{lid},{';'.join(parts[:4])}")["ok"]
              and p.cmd(f"ln_add,{lid},{';'.join(parts[4:])}")["ok"] and p.cmd(f"ln_end,{lid},{len(parts)}")["ok"], "uploaded in parts")
        got = line(lid)
        check([x["t"] for x in got["parts"]] == list("TWBHNLFC"), f"/api/line has the parts ({[x['t'] for x in got['parts']]})")
        check(got["parts"][1]["b"] == [[4, 5, 0], [5, 5, 0]] and got["parts"][1]["f"] == 2 and got["parts"][4]["s"] == "%E6%A1%9C", "tiles, flags and texts kept")
        check(p.status()["lines"][0]["parts"] == 8 and p.status()["lines"][0]["rev"] == got["rev"], "the status counts them and tells the revision")

        print("[2] rename, editing, refused parts, an interrupted upload")
        check(p.cmd(f"ln_name,{lid},Keio")["ok"] and p.status()["lines"][0]["name"] == "Keio", "renamed")
        check(not p.cmd(f"ln_name,{lid},")["ok"] and not p.cmd("ln_new,a/b")["ok"], "an empty name / a name with a separator refused")
        check(p.cmd(f"ln_edit,{lid},1")["ok"] and "editing" in p.status()["lines"][0], "somebody edits it (shown to the others)")
        check(p.cmd(f"ln_edit,{lid},0")["ok"] and "editing" not in p.status()["lines"][0], "editing ended")
        r = p.cmd(f"ln_begin,{lid}")
        r2 = p.cmd(f"ln_add,{lid},S/1/1/1/1/0/3:5:0/")
        check(r["ok"] and not r2["ok"], f"a part of a station's panel (start lever) is refused on a line panel ({r2.get('error')})")
        check(not p.cmd(f"ln_end,{lid},0")["ok"] and line(lid)["parts"][0]["t"] == "T", "the refused upload changed nothing")
        check(p.cmd(f"ln_begin,{lid}")["ok"] and p.cmd(f"ln_add,{lid},{parts[0]}")["ok"] and not p.cmd(f"ln_end,{lid},5")["ok"], "a part missing at the end: refused")
        check(len(line(lid)["parts"]) == 8, "the panel stayed as it was")
        check(not p.cmd("ln_add,99,L/1/1/1/1/0//x")["ok"], "an unknown line panel")
        check(p.cmd("ln_new,Inokashira")["ok"] and p.cmd("ln_new,Third")["ok"], "two more")
        third = next(x["id"] for x in p.status()["lines"] if x["name"] == "Third")
        check(p.cmd(f"ln_del,{third}")["ok"] and p.cmd("ln_new,Again")["ok"]
              and next(x["id"] for x in p.status()["lines"] if x["name"] == "Again") == third, "a deleted number is used again (the lowest free one)")

        print("[3] turn the map")
        before = line(lid)
        rot = simple_tool_id("TOOL_ROTATE90")
        p.request(f"debug_tool {rot} ")
        p.wait_event(lambda e: e["type"] == "rotated", 30)
        after = line(lid)
        check(after["parts"][0]["b"] != before["parts"][0]["b"] and (after["parts"][0]["x1"], after["parts"][0]["x2"]) == (2, 20),
              "the tiles turn, the drawing stays")
        check(after["rev"] != before["rev"], "a new revision: the panels fetch it again")
        for _ in range(3):
            p.request(f"debug_tool {rot} ")
            p.wait_event(lambda e: e["type"] == "rotated", 30)
        check(line(lid)["parts"] == before["parts"], "four turns restore the tiles")

        print("[4] save and load")
        # an upload interrupted by saving (a client joins in the middle of it)
        check(p.cmd(f"ln_begin,{lid}")["ok"] and p.cmd(f"ln_add,{lid},{parts[0]};{parts[5]}")["ok"], "an upload in progress")
        saved = p.status()["lines"]
        saved_parts = line(lid)["parts"]
        p.request("debug_save il_line")
        time.sleep(2)
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()

    time.sleep(1)
    game = start_game(args, ["-load", "il_line"])
    try:
        p = Panel(PORT)
        loaded = wait_until(lambda: (lambda s: s if s.get("lines") else None)(p.status()), 60, "loaded status")
        strip = lambda ls: [(x["id"], x["name"], x["parts"]) for x in ls]
        check(strip(loaded["lines"]) == strip(saved), f"line panels restored ({strip(loaded['lines'])})")
        check(line(lid)["parts"] == saved_parts, "their parts restored")
        check(p.cmd(f"ln_end,{lid},2")["ok"] and [x["t"] for x in line(lid)["parts"]] == ["T", "L"], "the upload goes on after loading: its parts were saved")

        print("[5] delete")
        check(p.cmd(f"ln_del,{lid}")["ok"] and all(x["id"] != lid for x in p.status()["lines"]), "deleted")
        check(line(lid)["parts"] == [], "nothing left of it")
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()
    print("LINE PANEL TEST DONE")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", required=True)
    ap.add_argument("--workdir", required=True)
    try:
        run(ap.parse_args())
    except AssertionError as e:
        print("TEST FAILED:", e)
        sys.exit(1)
