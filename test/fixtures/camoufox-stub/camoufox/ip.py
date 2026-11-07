# Stand-in for camoufox.ip: the computer's public address, or an error when FAIL["ip"] (no network).
from camoufox import sync_api

ASKED = []


def public_ip(proxy=None):
    ASKED.append(proxy)
    if sync_api.FAIL.get("ip") == "slow":
        import time
        time.sleep(1)
    elif sync_api.FAIL.get("ip"):
        raise ConnectionError("no network")
    return "203.0.113.7"
