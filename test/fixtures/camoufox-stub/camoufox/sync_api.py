# Stand-in for Camoufox in test/computer-secrets.test.js: one page on a site, its focused box accepts any field,
# and what is typed into it is kept in TYPED. LAUNCHES counts the browsers opened.
import time

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

    def is_closed(self):
        return False

    def evaluate(self, script, arg=None):
        return True if arg is None else "ok"

    def goto(self, url):
        self.url = url

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
