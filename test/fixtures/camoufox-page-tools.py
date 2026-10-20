# Runs the page tools of deploy/desktop/camoufox-browser (#170) on the stand-in Camoufox (camoufox-stub/): a login
# page with a password, a card code and two "Log in" buttons, and prints each answer as JSON.
# Usage: python3 camoufox-page-tools.py <launcher>
import importlib.machinery
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "camoufox-stub"))
from camoufox import sync_api  # noqa: E402

loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)

context = sync_api.Context()
page = context.pages[0]
page.url = "https://example.com/login"
page.elements = [
    {"role": "heading", "name": "Sign in"},
    {"role": "textbox", "name": "Email", "value": "me@example.com"},
    {"role": "textbox", "name": "Password", "value": "synthetic-password", "secret": True},
    {"role": "textbox", "name": "CVC", "value": "", "secret": True},
    {"role": "button", "name": "Log in"},
    {"role": "button", "name": "Log in"},
    {"role": "link", "name": "Help: FAQ"},
    {"role": "button", "name": ""},
]
tool = lambda **req: launcher.page_tool(context, req)  # noqa: E731
out = {}
out["snapshot"] = tool(op="snapshot")
out["click_second"] = tool(op="click", ref="e5")
out["click_colon"] = tool(op="click", ref="e6")
out["click_unnamed"] = tool(op="click", ref="e7")
out["fill_email"] = tool(op="fill", ref="e1", text="you@example.com")
out["fill_password"] = tool(op="fill", ref="e2", text="guess")
out["fill_cvc"] = tool(op="fill", ref="e3", text="123")
out["done"] = sync_api.DONE
out["unknown"] = tool(op="click", ref="e99")
page.elements = page.elements[:4] + page.elements[5:]  # one "Log in" is gone
out["gone"] = tool(op="click", ref="e5")
tool(op="snapshot")
page.url = "https://example.com/next"
out["moved"] = tool(op="click", ref="e4")
out["goto_file"] = tool(op="goto", url="file:///etc/passwd")
out["goto"] = tool(op="goto", url="https://example.org/")
out["wait_missing"] = tool(op="wait", text="Welcome", seconds=1)
out["wait_nothing"] = tool(op="wait")
page.elements = [{"role": "button", "name": f"Button number {i}"} for i in range(2000)]
out["long"] = tool(op="snapshot")
out["refs_long"] = len(launcher.refs)
print(json.dumps(out))
