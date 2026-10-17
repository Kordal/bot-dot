# Starts deploy/desktop/camoufox-browser --serve with a stand-in Camoufox (camoufox-stub/), its log and socket in a
# scratch folder and a small log cap, and prints as JSON what came of it. serve() takes this process's stdout, so
# the answer goes to a copy of it made first.
# Usage: python3 camoufox-bridge-log.py <launcher> <scratch dir> <cap in bytes> <scenario>
#   write    writes past the cap through its own stderr and through a child's, then waits for the last line
#   running  a bridge already answers on the socket, so this start must end by itself
#   nolog    the log cannot be opened (its folder does not exist); the bridge must still answer
#   crash    the bridge fails after taking the log (its socket's folder does not exist), so its traceback must reach it
#   broken   Camoufox cannot be imported, and a page is asked for: the bridge must say so in its log
#   again    the real bridge runs, and a second start checks it is there and ends by itself (#360)
#   gone     a client sends a real request and closes before the answer (#360)
#   empty    a client sends nothing: it is answered without the request reaching the browser's queue (#360)
import importlib.machinery
import importlib.util
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request

sys.dont_write_bytecode = True  # leave no __pycache__ beside the launcher or the stand-in
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "camoufox-stub"))

loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)

scratch, cap, scenario = sys.argv[2], int(sys.argv[3]), sys.argv[4]
answer = os.fdopen(os.dup(1), "w")
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    launcher.OPEN_PORT = s.getsockname()[1]
launcher.BRIDGE_SOCKET = os.path.join(scratch, "nofolder" if scenario == "crash" else "", "bridge.sock")
launcher.BRIDGE_LOG = os.path.join(scratch, "nofolder" if scenario == "nolog" else "", "bridge.log")
launcher.LOG_CAP = cap


def connected(listening=True):
    """A client of the bridge's socket. Its file is there from bind(), before listen(), and a connect in between is
    refused (macOS): until serve() is known to listen (`listening` false) a refused connect is tried again, which
    reaches no handler. Once it listens, a refused connect fails at once."""
    deadline = time.monotonic() + 10
    while True:
        c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        c.settimeout(10)
        try:
            c.connect(launcher.BRIDGE_SOCKET)
            return c
        except (ConnectionRefusedError, FileNotFoundError):
            c.close()
            if listening or time.monotonic() > deadline:
                raise
            time.sleep(0.05)


def ask(payload, listening=True):
    with connected(listening) as c:
        c.sendall(json.dumps(payload).encode())
        c.shutdown(socket.SHUT_WR)
        return json.loads(b"".join(iter(lambda: c.recv(65536), b"")))


def logged_until_mark():
    """The bridge's log once everything printed before this call has reached it."""
    time.sleep(0.3)  # lets a handler thread that still writes its answer finish
    print("mark", file=sys.stderr, flush=True)

    def marked():
        with open(launcher.BRIDGE_LOG, "rb") as f:
            return f.read().endswith(b"mark\n")
    return wait_for(marked)


def wait_for(check):
    for _ in range(200):
        if check():
            return True
        time.sleep(0.05)
    return False


out = {}
if scenario == "crash":
    launcher.serve()  # raises; the traceback goes to the log as the process exits
if scenario == "running":
    other = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    other.bind(launcher.BRIDGE_SOCKET)
    other.listen()
    threading.Thread(target=lambda: [other.accept()[0].close() for _ in iter(int, 1)], daemon=True).start()
    serve = threading.Thread(target=launcher.serve, daemon=True)
    serve.start()
    serve.join(10)
    out["returned"] = not serve.is_alive()
else:
    if scenario == "empty":
        queued = []

        class Spy(type(launcher.requests)):
            def put(self, item, *args, **kwargs):
                queued.append(dict(item[0]))
                super().put(item, *args, **kwargs)
        launcher.requests = Spy()
    threading.Thread(target=launcher.serve, daemon=True).start()
    out["where"] = ask({"op": "where"}, listening=False)
    if scenario == "write":
        line = "x" * 60
        for i in range(cap // 40):
            print(f"own {i:05d} {line}", file=sys.stderr, flush=True)
        child = "import sys\nfor i in range(%d): print(f'child {i:05d} %s', file=sys.stderr, flush=True)\nprint('child last', file=sys.stderr)"
        subprocess.run([sys.executable, "-c", child % (cap // 40, line)], check=True)
        print("own last", file=sys.stderr, flush=True)

        def drained():
            with open(launcher.BRIDGE_LOG, "rb") as f:
                return f.read().endswith(b"own last\n")
        out["drained"] = wait_for(drained)
    if scenario == "broken":
        sys.modules["camoufox.sync_api"] = None  # what a missing or broken Camoufox in the image raises

        def told():
            with open(launcher.BRIDGE_LOG, "rb") as f:
                return b"Camoufox did not start" in f.read()
        req = urllib.request.Request(f"http://127.0.0.1:{launcher.OPEN_PORT}/", json.dumps({"op": "open"}).encode())
        urllib.request.urlopen(req, timeout=10).read()
        out["told"] = wait_for(told)
    if scenario == "again":
        second = threading.Thread(target=launcher.serve, daemon=True)
        second.start()
        second.join(10)
        out["returned"] = not second.is_alive()
        out["where_after"] = ask({"op": "where"})
        out["marked"] = logged_until_mark()
    if scenario == "gone":
        with connected() as c:
            c.sendall(json.dumps({"op": "where"}).encode())
        out["where_after"] = ask({"op": "where"})
        out["marked"] = logged_until_mark()
    if scenario == "empty":
        queued.clear()
        with connected() as c:
            c.shutdown(socket.SHUT_WR)
            out["empty"] = json.loads(b"".join(iter(lambda: c.recv(65536), b"")))
        out["queued"] = queued
answer.write(json.dumps(out))
answer.flush()
os._exit(0)  # serve() never returns, and its threads are not to be waited for
