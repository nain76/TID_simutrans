#!/usr/bin/env python3
"""
Minimal console panel for the TID interlocking bridge (for trying it out).

  python3 il_cli.py [port]

Type a request per line, e.g.
  status
  signals 0 0 50 50
  cmd st_new,A station
  cmd sig_add,1,3,5,0
  cmd rt_def,1,3,5,0,8,5,0,1R-1
  cmd st_mode,1,1
  cmd set,2
All messages from the game are printed as they arrive. See interlocking/PROTOCOL.md.
"""

import socket
import sys
import threading


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 13360
    sock = socket.create_connection(("127.0.0.1", port))

    def reader():
        buf = b""
        while True:
            data = sock.recv(65536)
            if not data:
                print("-- connection closed")
                return
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                print("<", line.decode("utf-8"))

    threading.Thread(target=reader, daemon=True).start()
    for line in sys.stdin:
        line = line.strip()
        if line:
            sock.sendall((line + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
