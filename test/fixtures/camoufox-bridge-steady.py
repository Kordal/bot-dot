# Runs the parts of deploy/desktop/camoufox-browser that keep a bot's browser steady on the stand-in Camoufox
# (camoufox-stub/): a slow page, a page that can't be read after a step, a covered control, a request that waited too
# long, an open while Camoufox starts, a Camoufox 0.5.6 without camoufox.fingerprints.Screen, and how a secret is typed.
# Prints what came back as JSON. Usage: python3 camoufox-bridge-steady.py <launcher>
import importlib.machinery
import importlib.util
import json
import os
import queue
import sys
import threading
import time
import types
import urllib.request
from http.server import ThreadingHTTPServer

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "camoufox-stub"))
from camoufox import sync_api  # noqa: E402

loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)
out = {}

context = sync_api.Context()
page = context.pages[0]
page.url = "https://example.com/"
page.elements = [{"role": "button", "name": "Buy"}]
tool = lambda **req: launcher.browser_tool(context, req)  # noqa: E731

# A site slower than 15 s: what it shows so far.
sync_api.FAIL["goto"] = True
out["goto_slow"] = tool(op="goto", url="https://slow.example/")
sync_api.FAIL["goto"] = False

# A click that was done, on a page that can't be read right after it: said as done, never as failed.
tool(op="snapshot")
read = page.locator


class Unreadable:
    def aria_snapshot(self, timeout=0):
        raise TimeoutError("Timeout 10000ms exceeded.")


page.locator = lambda selector: Unreadable()
out["click_unread"] = tool(op="click", ref="e1")
out["snapshot_unread"] = tool(op="snapshot")
page.locator = read

# A control something else lies over.
tool(op="snapshot")
click = sync_api.Element.click


def covered(self, timeout=0):
    raise TimeoutError("Locator.click: Timeout 10000ms exceeded.\nCall log:\n  - <div class=\"cookie\"> intercepts pointer events")


sync_api.Element.click = covered
out["click_covered"] = tool(op="click", ref="e1")
sync_api.Element.click = click

# A secret, a key at a time with uneven pauses.
waits = []
page.wait_for_timeout = lambda ms: waits.append(ms)
sync_api.TYPED.clear()
launcher.type_like_a_person(page, "synthetic secret")
out["typed_keys"] = list(sync_api.TYPED)
out["waits"] = waits
del page.wait_for_timeout

# An open while Camoufox starts adds nothing to the queue: the browser that starts opens its own page.
with __import__("socket").socket() as s:
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
opener = ThreadingHTTPServer(("127.0.0.1", port), launcher.OpenHandler)
threading.Thread(target=opener.serve_forever, daemon=True).start()


def port_post(payload):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/", json.dumps(payload).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


launcher.browser_starting.set()
out["open_while_starting"] = port_post({"op": "open", "url": "https://example.com/"})
out["queued_while_starting"] = launcher.requests.qsize()
launcher.browser_starting.clear()
port_post({"op": "open", "url": "https://example.com/"})
out["queued_after"] = launcher.requests.qsize()
while not launcher.requests.empty():
    launcher.requests.get_nowait()
opener.shutdown()

# Camoufox 0.5.6 has no camoufox.fingerprints.Screen: the bridge takes browserforge's, and the browser opens.
old = types.ModuleType("camoufox.fingerprints")
forge = types.ModuleType("browserforge")
forge_fp = types.ModuleType("browserforge.fingerprints")
forge_fp.Screen = lambda **kw: ("browserforge", kw)
sys.modules["camoufox.fingerprints"] = old
sys.modules["browserforge"] = forge
sys.modules["browserforge.fingerprints"] = forge_fp
launcher.PROFILE = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"steady-profile-{os.getpid()}")
runner = threading.Thread(target=launcher.run_browser, args=("about:blank",), daemon=True)
runner.start()
for _ in range(100):
    if launcher.browser_open.is_set():
        break
    time.sleep(0.05)
out["opened_on_056"] = launcher.browser_open.is_set()
out["screen_from"] = sync_api.LAUNCHES[-1]["screen"][0] if sync_api.LAUNCHES else None
out["humanize"] = sync_api.LAUNCHES[-1].get("humanize") if sync_api.LAUNCHES else None

# A request that waited in the queue past its time is not done at all; one in time is.
reply = queue.Queue()
launcher.requests.put(({"op": "where", "_until": time.monotonic() + 5}, reply))
out["late"] = reply.get(timeout=5)
reply = queue.Queue()
launcher.requests.put(({"op": "where", "_until": time.monotonic() + 30}, reply))
out["in_time"] = reply.get(timeout=5)

sync_api.CONTEXTS[-1].pages = []  # the window closes
runner.join(5)
try:
    os.rmdir(launcher.PROFILE)
except OSError:
    pass
print(json.dumps(out))
