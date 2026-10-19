#!/usr/bin/env python3
"""
Robustness of the bridge (the connection of the panel to the game), scenario il-test.

  1. eight connections that never send anything (browsers open some in advance): the panel still gets in
  2. a line client that sends many requests and never reads the answers: the game does not stop,
     the client is dropped

Usage: bridge_test.py --sim build/default/sim --workdir <dir>
"""
import argparse, os, socket, subprocess, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_test import Panel, check, start_game, wait_until, PORT


def run(args):
    game = start_game(args, ["-scenario", "il-test"])
    try:
        p = Panel(PORT)
        wait_until(lambda: any(s["pos"] == [3, 5, 0] for s in p.request("signals 0 0 15 15")["signals"]), 60, "layout")

        print("[1] idle connections")
        idle = [socket.create_connection(("127.0.0.1", PORT)) for _ in range(8)]
        time.sleep(1)
        t0 = time.time()
        info = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/info", timeout=10).read()
        check(b"map" in info, f"the panel gets in while eight idle connections are open ({time.time() - t0:.1f} s)")
        for s in idle:
            s.close()

        print("[2] a client that does not read")
        stuck = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        stuck.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
        stuck.connect(("127.0.0.1", PORT))
        stuck.setblocking(False)
        req = b"tracks 0 0 15 15\n" * 200
        sent = 0
        end = time.time() + 5
        while time.time() < end:
            try:
                sent += stuck.send(req)
            except BlockingIOError:
                time.sleep(0.05)
            except OSError:
                break
        t0 = time.time()
        pong = p.request("ping")
        check(pong["type"] == "pong" and time.time() - t0 < 5, f"the game still answers ({time.time() - t0:.1f} s, {sent} bytes of requests sent)")
        wait_until(lambda: p.request("ping")["type"] == "pong", 10, "ping")
        dropped = False
        try:
            stuck.setblocking(True)
            stuck.settimeout(5)
            while stuck.recv(65536):
                pass
            dropped = True
        except OSError:
            dropped = True
        check(dropped, "the client that did not read was dropped")

        print("[3] a command longer than the game takes")
        p.send("cmd st_new," + "x" * 5000)
        err = p.answers.get(timeout=10)
        check(err.get("error") == "command too long", f"refused, not cut off ({err})")
        try:
            urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}/api/cmd", data=("st_new," + "y" * 5000).encode(), headers={"X-IL-Panel": "1"}), timeout=10)
            check(False, "the panel's long command was taken")
        except urllib.error.HTTPError as e:
            check(e.code == 400 and b"command too long" in e.read(), "the panel gets the reason, too")
        time.sleep(1)
        check(not p.status()["stations"], "no station was made from a cut-off command")
    finally:
        game.terminate()
        try:
            game.wait(10)
        except subprocess.TimeoutExpired:
            game.kill()
    print("BRIDGE TEST DONE")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", required=True)
    ap.add_argument("--workdir", required=True)
    try:
        run(ap.parse_args())
    except AssertionError as e:
        print("TEST FAILED:", e)
        sys.exit(1)
