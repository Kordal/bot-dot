# Runs deploy/desktop/camoufox-browser --serve with a stand-in Camoufox (camoufox-stub/) whose first page does not
# load and which raises as it closes (#875), and prints what is-open and the browser tools said at each step as JSON.
# Usage: python3 camoufox-bridge-fail.py <launcher> <scratch dir>
import importlib.machinery
import importlib.util
import json
import os
import socket
import sys
import threading
import time
import urllib.request

sys.dont_write_bytecode = True  # leave no __pycache__ beside the launcher or the stand-in
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "camoufox-stub"))
from camoufox import sync_api  # noqa: E402

loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)

with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
launcher.OPEN_PORT = port
launcher.BRIDGE_SOCKET = os.path.join(sys.argv[2], "bridge.sock")
launcher.PROFILE = os.path.join(sys.argv[2], "profile")
threading.Thread(target=launcher.serve, daemon=True).start()


def bridge(payload):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as c:
        c.settimeout(10)
        c.connect(launcher.BRIDGE_SOCKET)
        c.sendall(json.dumps(payload).encode())
        c.shutdown(socket.SHUT_WR)
        return json.loads(b"".join(iter(lambda: c.recv(65536), b"")))


def port_post(payload):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/", json.dumps(payload).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def until(check):
    for _ in range(100):
        if check():
            return
        time.sleep(0.05)


until(lambda: os.path.exists(launcher.BRIDGE_SOCKET))
out = {}
sync_api.FAIL["goto"] = True
port_post({"op": "open", "url": "https://slow.example/"})
until(lambda: sync_api.CONTEXTS)
time.sleep(0.3)
sync_api.FAIL["goto"] = False
out["is_open_after_slow_page"] = port_post({"op": "is-open"})["open"]
out["goto_after_slow_page"] = bridge({"op": "goto", "url": "https://example.com/"}).get("ok")

sync_api.FAIL["exit"] = True
sync_api.CONTEXTS[-1].pages.clear()  # the window closes, and closing raises
until(lambda: not port_post({"op": "is-open"})["open"])
out["is_open_after_close"] = port_post({"op": "is-open"})["open"]
out["goto_after_close"] = bridge({"op": "goto", "url": "https://example.com/"}).get("ok")

sync_api.FAIL["exit"] = False
port_post({"op": "open", "url": "https://example.com/"})
until(lambda: len(sync_api.LAUNCHES) > 1)
time.sleep(0.3)
out["is_open_after_reopen"] = port_post({"op": "is-open"})["open"]
out["launches"] = len(sync_api.LAUNCHES)
print(json.dumps(out))
