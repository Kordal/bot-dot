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
print(json.dumps(out))
