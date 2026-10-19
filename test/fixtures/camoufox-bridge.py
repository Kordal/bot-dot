# Runs deploy/desktop/camoufox-browser --serve with a stand-in Camoufox (camoufox-stub/) on a scratch socket and
# port, sends it what botdot and a bot's program would, and prints what came back and what was typed as JSON.
# Usage: python3 camoufox-bridge.py <launcher> <scratch dir>
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


for _ in range(100):
    if os.path.exists(launcher.BRIDGE_SOCKET):
        break
    time.sleep(0.05)
out = {}
out["where_closed"] = bridge({"op": "where"})
out["secret_on_port"] = port_post({"site": "example.com", "field": "password", "value": "synthetic-port-secret"})
out["where_on_port"] = port_post({"op": "where"})
out["is_open_closed"] = port_post({"op": "is-open"})
out["open"] = port_post({"op": "open", "url": "https://example.com/login"})
for _ in range(100):
    if sync_api.LAUNCHES:
        break
    time.sleep(0.05)
time.sleep(0.5)
out["where_open"] = bridge({"op": "where"})
out["is_open"] = port_post({"op": "is-open"})
out["secret"] = bridge({"site": "example.com", "field": "password", "value": "synthetic-secret"})
out["typed"] = sync_api.TYPED
out["launches"] = len(sync_api.LAUNCHES)
print(json.dumps(out))
