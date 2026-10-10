#!/usr/bin/env python3
"""
End-to-end test of the TID interlocking panel.

Starts the headless game (posix backend) with the scenario "il-test",
drives it through the panel bridge (TCP, 127.0.0.1) and checks:
  1. a train waits at an interlocked signal in operator mode
  2. conflicting routes are refused, cancel works
  3. the train follows the route set by the operator (platform 2)
  4. the route is released automatically after the train has passed
  5. rotating the map keeps the definitions consistent
  6. the definitions survive saving and loading

Usage:
  run_test.py --sim build/default/sim --workdir <dir with pak64/, config/, text/>

The workdir must contain pak64/scenario/il-test (link to interlocking/tests/il-test).
"""

import argparse
import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time

PORT = 13360
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def simple_tool_id(name):
    """index of a simple tool in simmenu.h (TOOL_PAUSE = 0 ... SIMPLE_TOOL_COUNT)"""
    text = open(os.path.join(REPO, "simmenu.h"), encoding="utf-8").read()
    block = text[text.index("TOOL_PAUSE = 0"):text.index("SIMPLE_TOOL_COUNT")]
    names = re.findall(r"^\s*(\w+)\s*(?:=\s*0)?\s*,", block, re.M)
    return names.index(name)


class Panel:
    def __init__(self, port):
        self.events = queue.Queue()
        self.answers = queue.Queue()
        for _ in range(120):
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=1)
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("cannot connect to the bridge")
        self.sock.settimeout(None)
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        buf = b""
        while True:
            data = self.sock.recv(65536)
            if not data:
                return
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                msg = json.loads(line.decode("utf-8"))
                if msg["type"] in ("status", "signals", "convoys", "pong", "error", "debug_tool", "debug_save"):
                    self.answers.put(msg)
                else:
                    self.events.put(msg)

    def request(self, line):
        self.sock.sendall((line + "\n").encode("utf-8"))
        return self.answers.get(timeout=20)

    def send(self, line):
        self.sock.sendall((line + "\n").encode("utf-8"))

    def wait_event(self, pred, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            try:
                ev = self.events.get(timeout=max(0.1, end - time.time()))
            except queue.Empty:
                break
            if pred(ev):
                return ev
        raise AssertionError("timeout waiting for event")

    def cmd(self, param):
        """sends a command and returns its result event"""
        self.send("cmd " + param)
        return self.wait_event(lambda e: e["type"] == "result" and e["command"] == param)

    def status(self):
        return self.request("status")


def check(cond, text):
    print(("  OK   " if cond else "  FAIL ") + text)
    if not cond:
        raise AssertionError(text)


def start_game(args, extra):
    env = dict(os.environ, TID_IL_PORT=str(PORT), TID_IL_DEBUG="1")
    log = open(os.path.join(args.workdir, "il_test_game.log"), "w")
    cmdline = [os.path.abspath(args.sim), "-set_workdir", args.workdir, "-singleuser", "-objects", "pak64/",
               "-lang", "en", "-nosound", "-nomidi", "-debug", "2", "-fps", "25"] + extra
    return subprocess.Popen(cmdline, cwd=args.workdir, env=env, stdout=log, stderr=subprocess.STDOUT)


def wait_until(fn, timeout, text):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.3)
    raise AssertionError("timeout: " + text)


def run(args):
    game = start_game(args, ["-scenario", "il-test"])
    try:
        p = Panel(PORT)

        # wait for the scenario to build the layout (signal S1 at (3,5,0))
        wait_until(lambda: any(s["pos"] == [3, 5, 0] for s in p.request("signals 0 0 15 15")["signals"]), 60, "layout")
        print("[1] configure the interlocking")
        r = p.cmd("st_new,A station, east")
        check(r["ok"], "create station")
        st0 = p.status()["stations"][0]
        sid = st0["id"]
        check(st0["name"] == "A station, east", "station name may contain commas")
        check(not p.cmd(f"rt_def,{sid},3,5,0,8,5,0,x")["ok"], "route from an unregistered signal is refused")
        check(p.cmd(f"sig_add,{sid},3,5,0")["ok"], "register S1 as interlocked signal")
        check(not p.cmd(f"sig_add,{sid},3,5,0")["ok"], "registering S1 twice is refused")
        check(not p.cmd(f"sig_add,{sid},2,5,0")["ok"], "no signal at (2,5): refused")
        check(p.cmd(f"rt_def,{sid},3,5,0,8,5,0,S1-1")["ok"], "define route S1 -> platform 1")
        check(p.cmd(f"rt_def,{sid},3,5,0,8,6,0,S1-2")["ok"], "define route S1 -> platform 2")
        routes = {rt["name"]: rt for rt in p.status()["routes"]}
        r1, r2 = routes["S1-1"], routes["S1-2"]
        check(r1["tiles"][0] == [3, 5, 0] and r1["tiles"][-1] == [8, 5, 0], "route 1 runs from S1 to (8,5)")
        check([4, 6, 0] in r2["tiles"] and r2["tiles"][-1] == [8, 6, 0], "route 2 runs over the junction to (8,6)")
        check(not p.cmd(f"set,{r1['id']}")["ok"], "setting a route in automatic mode is refused")
        check(p.cmd(f"st_mode,{sid},1")["ok"], "switch to operator mode")

        print("[2] the train waits at S1")
        cid = p.request("debug_convoys")["convoys"][0]["id"]
        sched = "0|0|0|2|0|14,5,0,0,0,0,0,0,0,0,0,100|7,5,0,0,0,0,0,0,0,0,0,100|"
        p.request(f"debug_tool {simple_tool_id('TOOL_CHANGE_CONVOI')} g,{cid},{sched}")
        time.sleep(1)
        p.request(f"debug_tool {simple_tool_id('TOOL_CHANGE_DEPOT')} b,1,5,0,{cid}")
        time.sleep(10)
        cnv = p.request("debug_convoys")["convoys"][0]
        sig = [s for s in p.status()["stations"][0]["signals"] if s["pos"] == [3, 5, 0]][0]
        check(cnv["state"] in (8, 9, 13) and cnv["speed"] == 0 and cnv["pos"] == [3, 5, 0],
              f"train left the depot and waits in front of S1 (pos {cnv['pos']}, state {cnv['state']})")
        check(sig["aspect"] == "red", "S1 shows danger")

        print("[3] conflicting routes")
        check(p.cmd(f"set,{r1['id']}")["ok"], "set route 1")
        res = p.cmd(f"set,{r2['id']}")
        check(not res["ok"], f"route 2 refused while route 1 is set ({res.get('error')})")
        check(p.cmd(f"cancel,{r1['id']}")["ok"], "cancel route 1")

        print("[4] the train follows route 2")
        seen = []
        stop = threading.Event()

        def watch():
            while not stop.is_set():
                try:
                    seen.append(tuple(p.request("debug_convoys")["convoys"][0]["pos"]))
                except Exception:
                    return
                time.sleep(0.2)
        check(p.cmd(f"set,{r2['id']}")["ok"], "set route 2")
        t = threading.Thread(target=watch, daemon=True)
        t.start()
        p.wait_event(lambda e: e["type"] == "route" and e["id"] == r2["id"] and e["state"] == "occupied", 60)
        check(True, "train admitted into route 2 (state occupied)")
        p.wait_event(lambda e: e["type"] == "route" and e["id"] == r2["id"] and e["state"] == "idle", 120)
        check(True, "route 2 released automatically after the train passed")
        wait_until(lambda: any(pos[0] >= 13 for pos in seen), 120, "train reaches station B")
        stop.set()
        first_p2 = next((i for i, pos in enumerate(seen) if pos[1] == 6 and 6 <= pos[0] <= 8), None)
        first_b = next(i for i, pos in enumerate(seen) if pos[0] >= 13)
        check(first_p2 is not None and first_p2 < first_b, "train ran over platform 2 (y=6) on its way to B")
        check(not any(pos[1] == 5 and 6 <= pos[0] <= 8 for pos in seen[:first_b]), "train did not use platform 1")

        print("[5] rotate the map")
        rot = simple_tool_id("TOOL_ROTATE90")
        before = p.status()
        p.request(f"debug_tool {rot} ")
        p.wait_event(lambda e: e["type"] == "rotated", 30)
        after = p.status()
        s_after = after["stations"][0]["signals"][0]
        check(s_after["pos"] != [3, 5, 0] and s_after["aspect"] != "missing", f"signal follows the rotation ({s_after['pos']})")
        for _ in range(3):
            p.request(f"debug_tool {rot} ")
            p.wait_event(lambda e: e["type"] == "rotated", 30)
        check([r["tiles"] for r in p.status()["routes"]] == [r["tiles"] for r in before["routes"]], "four rotations restore the route tiles")
        check(p.status()["stations"][0]["signals"][0]["pos"] == [3, 5, 0], "four rotations restore the signal position")

        print("[6] save and load")
        check(p.cmd(f"set,{r1['id']}")["ok"], "set route 1 before saving")
        saved = p.status()
        p.request("debug_save il_test")
        time.sleep(2)
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()

    time.sleep(1)
    game = start_game(args, ["-load", "il_test"])
    try:
        p = Panel(PORT)
        loaded = wait_until(lambda: (lambda s: s if s["stations"] else None)(p.status()), 60, "loaded status")
        strip_st = lambda sts: [(st["id"], st["name"], st["owner"], st["manual"], [sg["pos"] for sg in st["signals"]]) for st in sts]
        check(strip_st(loaded["stations"]) == strip_st(saved["stations"]), "stations restored (name, owner, mode, signals)")
        strip = lambda rs: [(r["id"], r["name"], r["state"], r["tiles"]) for r in rs]
        check(strip(loaded["routes"]) == strip(saved["routes"]), "routes and their states restored")
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()
    print("ALL TESTS PASSED")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", required=True)
    ap.add_argument("--workdir", required=True)
    try:
        run(ap.parse_args())
    except AssertionError as e:
        print("TEST FAILED:", e)
        sys.exit(1)
