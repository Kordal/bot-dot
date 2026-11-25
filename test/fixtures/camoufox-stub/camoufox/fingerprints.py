# Stand-in for camoufox.fingerprints in test/computer-secrets.test.js. MADE counts the identities generated.
import random

MADE = []


class Screen:
    def __init__(self, max_width=None, max_height=None, **kwargs):
        self.max_width, self.max_height = max_width, max_height


def generate_fingerprint(window=None, screen=None, os=None, **conditions):
    MADE.append({"window": window, "os": os, "screen": [screen.max_width, screen.max_height]})
    return {"navigator": {"userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0"},
            "screen": {"width": screen.max_width, "height": screen.max_height}, "window": {"outerWidth": window[0], "outerHeight": window[1]},
            "seed": random.random()}
