# Stand-in for Camoufox in test/computer-secrets.test.js: one page on a site, its focused box accepts any field,
# and what is typed into it is kept in TYPED. LAUNCHES counts the browsers opened.
# For the page tools (test/browser-page.test.js, #170) a page holds `elements`, dicts of role, name, value and secret,
# drawn as an aria snapshot that, unlike botdot's, shows every box's value; what is clicked or filled is kept in DONE.
import json
import time

DONE = []


class Element:
    def __init__(self, page, el):
        self.page, self.el = page, el

    def click(self, timeout=0):
        DONE.append(["click", self.el["role"], self.el["name"], next(i for i, el in enumerate(self.page.elements) if el is self.el)])

    def fill(self, text, timeout=0):
        self.el["value"] = text
        DONE.append(["fill", self.el["name"], text])

    def evaluate(self, script):
        return bool(self.el.get("secret"))

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


class Keyboard:
    def type(self, text, delay=0):
        TYPED.append(text)

    def press(self, key):
        TYPED.append(key)


class Page:
    def __init__(self):
        self.url = "about:blank"
        self.keyboard = Keyboard()
        self.frames = [self]
        self.elements = []

    def is_closed(self):
        return False

    def evaluate(self, script, arg=None):
        if "querySelectorAll('input')" in script:
            return [el["value"] for el in self.elements if el.get("secret") and el.get("value")]
        return True if arg is None else "ok"

    def goto(self, url, **kwargs):
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

    def __enter__(self):
        return Context()

    def __exit__(self, *exc):
        return False
