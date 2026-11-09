# Stand-in for Camoufox in test/computer-secrets.test.js: one page on a site, its focused box accepts any field,
# and what is typed into it is kept in TYPED. LAUNCHES counts the browsers opened.
# For the browser tools (test/browser-page.test.js, #170) a page holds `elements`, dicts of role, name, value and secret,
# drawn as an aria snapshot that, unlike botdot's, shows every box's value; what is clicked or filled is kept in DONE.
import json
import time

DONE = []


class Element:
    def __init__(self, page, el):
        self.page, self.el = page, el

    def click(self, timeout=0):
        DONE.append(["click", self.el["role"], self.el["name"], next(i for i, el in enumerate(self.page.elements) if el is self.el)])
        self.page.focused = self.el

    def input_value(self, timeout=0):
        return self.el.get("value", "")

    def select_option(self, label=None, value=None, timeout=0):
        options = self.el.get("options")
        if options is None:
            raise RuntimeError("Element is not a <select> element")
        for shown, val in options:
            if label is not None and shown == label or value is not None and val == value:
                self.el["value"] = shown
                DONE.append(["select", self.el["name"], shown])
                return [val]
        raise TimeoutError("Timeout 5000ms exceeded.")

    def fill(self, text, timeout=0):
        if self.el["role"] not in ("textbox", "searchbox", "combobox"):
            raise RuntimeError("Error: Element is not an <input>, <textarea> or [contenteditable] element")
        self.el["value"] = text
        DONE.append(["fill", self.el["name"], text])

    def evaluate(self, script):
        if "TEXTAREA" in script:  # a box that takes text
            return self.el["role"] in ("textbox", "searchbox")
        return bool(self.el.get("secret"))

    def is_editable(self, timeout=0):
        if self.el["role"] not in ("textbox", "searchbox", "combobox"):
            raise RuntimeError("Error: Element is not an <input>, <textarea>, <select> or [contenteditable]")
        return not self.el.get("readonly")

    def wait_for(self, state="visible", timeout=0):
        pass


class Found:
    def __init__(self, page, els):
        self.page, self.els = page, els

    def count(self):
        return len(self.els)

    def nth(self, n):
        return Element(self.page, self.els[n])

    @property
    def first(self):
        return Element(self.page, self.els[0]) if self.els else Missing()


class Missing:
    def wait_for(self, state="visible", timeout=0):
        raise TimeoutError(f"Timeout {timeout:g}ms exceeded.")


class Body:
    def __init__(self, page):
        self.page = page

    def aria_snapshot(self, timeout=0):
        lines = []
        for el in self.page.elements:
            key = el["role"] + (" " + json.dumps(el["name"]) if el["name"] else "")
            if ":" in key:
                key = "'" + key.replace("'", "''") + "'"
            lines.append(f"- {key}" + (f": {el['value']}" if el.get("value") else ""))
        return "\n".join(lines)

TYPED = []
LAUNCHES = []
CONTEXTS = []  # each browser's context: closing its pages closes the window
# A page that does not load, a browser that raises as it closes (#875), no network to find the computer's address, and
# a Camoufox that no longer takes a kept identity.
FAIL = {"goto": False, "exit": False, "ip": False, "identity": False}


class Keyboard:
    """Keys go to TYPED and, like a browser's, into the box clicked last: Control+a selects all it holds."""
    def __init__(self, page=None):
        self.page, self.selected = page, False

    def box(self):
        return getattr(self.page, "focused", None) if self.page is not None else None

    def type(self, text, delay=0):
        TYPED.append(text)
        el = self.box()
        if el is not None and not el.get("typeless"):
            el["value"] = text if self.selected else el.get("value", "") + text
            self.selected = False

    def press(self, key):
        TYPED.append(key)
        el = self.box()
        if el is not None and key == "Control+a":
            self.selected = True
        elif el is not None and key == "Backspace" and self.selected:
            el["value"], self.selected = "", False


class Page:
    def __init__(self):
        self.url = "about:blank"
        self.keyboard = Keyboard(self)
        self.focused = None
        self.frames = [self]
        self.elements = []

    def is_closed(self):
        return False

    def evaluate(self, script, arg=None):
        if "querySelectorAll('input')" in script:
            return [el["value"] for el in self.elements if el.get("secret") and el.get("value")]
        return True if arg is None else "ok"

    def goto(self, url, **kwargs):
        if FAIL["goto"]:
            raise TimeoutError("Timeout 30000ms exceeded.")
        self.url = url

    def title(self):
        return "Stand-in"

    def locator(self, selector):
        return Body(self)

    def get_by_role(self, role, name=None, exact=False):
        return Found(self, [el for el in self.elements if el["role"] == role and (name is None or el["name"] == name)])

    def get_by_text(self, text):
        return Found(self, [el for el in self.elements if text in (el["name"] or "")])

    def wait_for_load_state(self, state, timeout=0):
        pass

    def bring_to_front(self):
        pass

    def wait_for_timeout(self, ms):
        time.sleep(ms / 1000)


class Context:
    def __init__(self):
        self.pages = [Page()]

    def on(self, event, handler):
        pass

    def new_page(self):
        page = Page()
        self.pages.append(page)
        return page


class Camoufox:
    def __init__(self, **kwargs):
        LAUNCHES.append(kwargs)
        if FAIL["identity"] and "fingerprint" in kwargs:  # True: Camoufox refuses it; an exception class: the start fails so
            raise (ValueError("Unknown fingerprint field") if FAIL["identity"] is True else FAIL["identity"]("Firefox crashed"))

    def __enter__(self):
        CONTEXTS.append(Context())
        return CONTEXTS[-1]

    def __exit__(self, *exc):
        if FAIL["exit"]:
            raise RuntimeError("Target page, context or browser has been closed")
        return False
