# Stand-in for camoufox.fingerprints in test/computer-secrets.test.js. MADE counts the identities generated.
import random

MADE = []


class Screen:
    def __init__(self, **kwargs):
        pass


def generate_fingerprint(window=None, screen=None, os=None, **conditions):
    MADE.append({"window": window, "os": os})
    return {"navigator": {"userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0"},
            "screen": {"width": 1024, "height": 768}, "window": {"outerWidth": window[0], "outerHeight": window[1]},
            "seed": random.random()}
