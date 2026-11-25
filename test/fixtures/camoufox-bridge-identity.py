# Runs how deploy/desktop/camoufox-browser starts a bot's Camoufox on the stand-in (camoufox-stub/): the bot's own
# identity, kept in its profile, its place from the computer's address (geoip) and the owner's language. Prints what
# each start was given as JSON. Usage: python3 camoufox-bridge-identity.py <launcher> <scratch dir>
import importlib.machinery
import importlib.util
import json
import os
import stat
import sys
import threading
import time
import types

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "camoufox-stub"))
from camoufox import fingerprints, ip, sync_api  # noqa: E402

loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)
launcher.PROFILE = os.path.join(sys.argv[2], "profile")
out = {}
real_screen_size = launcher.screen_size
real_x11_screen = launcher.x11_screen
launcher.screen_size = lambda: ((1280, 800), True)  # the screen of the current desktop image, whatever DISPLAY this test runs under
launcher.x11_screen = lambda: None  # libX11 is read below, against a stand-in
os.environ.pop("BOTDOT_SCREEN", None)


def start():
    """One start of the bot's browser, closed again: what Camoufox was given."""
    runner = threading.Thread(target=launcher.run_browser, args=("about:blank",), daemon=True)
    runner.start()
    for _ in range(100):
        if launcher.browser_open.is_set():
            break
        time.sleep(0.05)
    sync_api.CONTEXTS[-1].pages = []  # the window closes
    runner.join(5)
    given = dict(sync_api.LAUNCHES[-1])
    return {k: given.get(k) for k in ("fingerprint", "geoip", "locale")}


os.environ["BOTDOT_LOCALE"] = "pl-PL"
first, second = start(), start()
out["same_identity"] = first["fingerprint"] == second["fingerprint"] and first["fingerprint"] is not None
out["made"] = len(fingerprints.MADE)
out["made_with"] = fingerprints.MADE[0]
path = os.path.join(launcher.PROFILE, launcher.IDENTITY_FILE)
out["kept_mode"] = oct(stat.S_IMODE(os.stat(path).st_mode))
out["geoip"] = first["geoip"]
out["locale"] = first["locale"]

# No network: no geoip, and the address is not asked again at the next start, for a while.
launcher.geoip_failed_at = None
sync_api.FAIL["ip"] = True
asked = len(ip.ASKED)
out["offline"] = start()
out["offline_again"] = start()
out["asked_offline"] = len(ip.ASKED) - asked
sync_api.FAIL["ip"] = False
launcher.geoip_failed_at = None

# A slow network: the start waits for the address only so long.
sync_api.FAIL["ip"] = "slow"
began = time.monotonic()
out["slow"] = launcher.where_from_quickly(0.2)
out["slow_waited"] = round(time.monotonic() - began, 1)
sync_api.FAIL["ip"] = False
launcher.geoip_failed_at = None

# A start that fails for another reason (Firefox crashed): opened without, and the identity stays.
sync_api.FAIL["identity"] = RuntimeError
out["crashed"] = start()["fingerprint"]
out["kept_after_crash"] = os.path.exists(path)
sync_api.FAIL["identity"] = False
out["same_after_crash"] = start()["fingerprint"] == first["fingerprint"]

# A language botdot doesn't know of is not passed on.
os.environ["BOTDOT_LOCALE"] = "pl_PL; rm -rf"
out["bad_locale"] = start()["locale"]
os.environ["BOTDOT_LOCALE"] = "en-US"

# A Camoufox that no longer takes the kept identity: the browser opens without it, and the next start makes a new one.
sync_api.FAIL["identity"] = True
launches = len(sync_api.LAUNCHES)
out["refused"] = start()
out["tries"] = len(sync_api.LAUNCHES) - launches
out["put_aside"] = os.path.exists(path + ".unused") and not os.path.exists(path)
sync_api.FAIL["identity"] = False
renewed = start()
out["renewed"] = renewed["fingerprint"] is not None and renewed["fingerprint"] != first["fingerprint"]

# The screen is the real display's size, 1280x800 when it can't be read (a computer on an older desktop image is
# still 1024x768 until its Update).
bin_dir = os.path.join(sys.argv[2], "bin")
os.makedirs(bin_dir)


def tool(name, text):
    path = os.path.join(bin_dir, name)
    with open(path, "w") as f:
        f.write(f"#!/bin/sh\necho '{text}'\n")
    os.chmod(path, 0o755)


os.environ["PATH"] = bin_dir
out["no_tool"] = real_screen_size()
tool("xdpyinfo", "  dimensions:    1024x768 pixels (271x203 millimeters)")
out["xdpyinfo"] = real_screen_size()
os.remove(os.path.join(bin_dir, "xdpyinfo"))
tool("xrandr", "Screen 0: minimum 1 x 1, current 1152 x 720, maximum 32767 x 32767")
out["xrandr"] = real_screen_size()
tool("xrandr", "something else")
out["unreadable"] = real_screen_size()
tool("xrandr", "Screen 0: minimum 1 x 1, current 99999 x 1, maximum 1 x 1")
out["absurd"] = real_screen_size()
launcher.screen_size = real_screen_size  # as it runs on the bot's screen: the window is the screen's less the title bar
tool("xdpyinfo", "  dimensions:    1024x768 pixels (271x203 millimeters)")


def write_identity(screen, made_for=None):
    kept = {"navigator": {"userAgent": "kept"}, "screen": {"width": screen[0], "height": screen[1]}, "seed": 1}
    if made_for:
        kept["botdot_screen"] = made_for
    with open(path, "w") as f:
        json.dump(kept, f)


def kept_screen():
    with open(path) as f:
        return json.load(f)["botdot_screen"]


cookies = os.path.join(launcher.PROFILE, "cookies.sqlite")
with open(cookies, "w") as f:
    f.write("logins")

# An old desktop (1024x768): an identity made for that screen, before screens were noted, is kept and no new one is made.
write_identity((1024, 768))
made = len(fingerprints.MADE)
os.environ["PATH"] = bin_dir
old = start()
out["old_desktop_kept"] = old["fingerprint"]["navigator"]["userAgent"] == "kept" and len(fingerprints.MADE) == made
out["old_desktop_window"] = sync_api.LAUNCHES[-1]["window"]
# An identity whose screen is larger than this one is made again.
write_identity((1280, 800), [1280, 800])
out["old_desktop_renewed"] = start()["fingerprint"]["navigator"]["userAgent"] != "kept" and len(fingerprints.MADE) == made + 1
out["old_desktop_made_for"] = kept_screen()
# The Update gives the screen 1280x800: the identity made for 1024x768 (noted, or from before it was) is made again.
os.environ["PATH"] = os.defpath
launcher.screen_size = lambda: ((1280, 800), True)
for name, noted in (("unnoted", None), ("noted", [1024, 768])):
    write_identity((1024, 768), noted)
    made = len(fingerprints.MADE)
    out[f"update_renewed_{name}"] = start()["fingerprint"]["navigator"]["userAgent"] != "kept" and len(fingerprints.MADE) == made + 1
out["update_window"] = sync_api.LAUNCHES[-1]["window"]
out["update_made_with"] = fingerprints.MADE[-1]
out["update_made_for"] = kept_screen()
out["update_cookies_kept"] = open(cookies).read() == "logins"
# What was made for 1280x800 stays, whatever its own screen: one 1280x720 is not made again at every start.
write_identity((1280, 720), [1280, 800])
made = len(fingerprints.MADE)
out["same_size_kept"] = start()["fingerprint"]["navigator"]["userAgent"] == "kept" and len(fingerprints.MADE) == made

# botdot says the screen (BOTDOT_SCREEN) before the display is read: a boat.dev machine's :0 is 1920x1080, and its
# bots' screen stays 1024x768, so a window of 1024x740 and the identity they have, which was made for 1024x768 (before
# screens were noted, or noted).
launcher.screen_size = real_screen_size
os.environ["PATH"] = bin_dir
tool("xdpyinfo", "  dimensions:    1920x1080 pixels (508x285 millimeters)")
out["display_1080"] = real_screen_size()
os.environ["BOTDOT_SCREEN"] = "1024x768"
out["given"] = real_screen_size()
for name, noted in (("unnoted", None), ("noted", [1024, 768])):
    write_identity((1024, 768), noted)
    made = len(fingerprints.MADE)
    out[f"given_kept_{name}"] = start()["fingerprint"]["navigator"]["userAgent"] == "kept" and len(fingerprints.MADE) == made
    out[f"given_window_{name}"] = sync_api.LAUNCHES[-1]["window"]
os.environ["BOTDOT_SCREEN"] = "99999x1"
out["given_absurd"] = real_screen_size()  # not taken: the display is read
os.environ["BOTDOT_SCREEN"] = "big"
out["given_nonsense"] = real_screen_size()
del os.environ["BOTDOT_SCREEN"]

# A reading that failed (no tool, no display to reach: a start of the bridge alone) uses the window of 1280x800 but
# never makes a new identity: what is kept stays, whatever screen it was made for.
empty = os.path.join(sys.argv[2], "empty")
os.makedirs(empty)
os.environ["PATH"] = empty
out["unread"] = real_screen_size()
for name, made_for, own in (("unnoted", None, (1024, 768)), ("noted_small", [1024, 768], (1024, 768)), ("noted_large", [1920, 1080], (1920, 1080))):
    write_identity(own, made_for)
    made = len(fingerprints.MADE)
    out[f"unread_kept_{name}"] = start()["fingerprint"]["navigator"]["userAgent"] == "kept" and len(fingerprints.MADE) == made
    out[f"unread_window_{name}"] = sync_api.LAUNCHES[-1]["window"]
os.remove(path)
made = len(fingerprints.MADE)
start()
out["unread_first"] = len(fingerprints.MADE) == made + 1 and fingerprints.MADE[-1]["window"]  # with none kept, one is made

# libX11 first (the desktop has it for Firefox): the default screen of XOpenDisplay(NULL), the display closed again.
os.environ["PATH"] = bin_dir
calls = []
x11 = types.SimpleNamespace(
    XOpenDisplay=lambda name: calls.append(("open", name)) or 7,
    XDefaultScreen=lambda display: 0,
    XDisplayWidth=lambda display, number: 1600,
    XDisplayHeight=lambda display, number: 900,
    XCloseDisplay=lambda display: calls.append(("close", display)),
)
real_cdll = launcher.ctypes.CDLL
launcher.x11_screen = real_x11_screen
try:
    launcher.ctypes.CDLL = lambda name: x11
    out["x11"] = real_screen_size()  # the stand-in xdpyinfo says 1920x1080: libX11 is asked first
    out["x11_calls"] = list(calls)
    x11.XOpenDisplay = lambda name: None  # no display to reach
    out["x11_no_display"] = [real_x11_screen(), real_screen_size()]  # then xdpyinfo
    x11.XOpenDisplay = lambda name: 7
    x11.XDisplayWidth = lambda display, number: 99999
    out["x11_absurd"] = real_screen_size()
    def no_library(name):
        raise OSError("libX11.so.6: cannot open shared object file")
    launcher.ctypes.CDLL = no_library
    out["x11_missing"] = [real_x11_screen(), real_screen_size()]
finally:
    launcher.ctypes.CDLL = real_cdll
print(json.dumps(out))
