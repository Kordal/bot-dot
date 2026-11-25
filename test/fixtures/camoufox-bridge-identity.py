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
launcher.screen_size = lambda: (1280, 800)  # the screen of the current desktop image, whatever DISPLAY this test runs under


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
launcher.screen_size = lambda: (1280, 800)
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
print(json.dumps(out))
