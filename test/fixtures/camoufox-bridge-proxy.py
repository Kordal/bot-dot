# Runs deploy/desktop/camoufox-browser's proxy (ADR 171) against stand-in proxies on the loopback: a SOCKS5 and an
# HTTP proxy that take one login and reach one echo server whatever name they are given, and keep the names they were
# asked for. Prints what happened as JSON. Usage: python3 camoufox-bridge-proxy.py <launcher> <scratch dir>
import base64
import importlib.machinery
import importlib.util
import json
import os
import socket
import socketserver
import stat
import struct
import sys
import threading
import time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "camoufox-stub"))
from camoufox import sync_api  # noqa: E402

loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)
scratch = sys.argv[2]
launcher.PROFILE = os.path.join(scratch, "profile")
launcher.PROXY_FILE = os.path.join(scratch, "proxy-7.json")
launcher.BOT = "hunter"
ASKED = []  # the names the proxies were asked for
out = {}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        data = self.request.recv(1024)
        self.request.sendall(b"echo:" + data)


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


echo = Server(("127.0.0.1", 0), Echo)
ECHO = echo.server_address
threading.Thread(target=echo.serve_forever, daemon=True).start()


def read(sock, n):
    data = b""
    while len(data) < n:
        data += sock.recv(n - len(data))
    return data


def relay(a, b):
    try:
        while True:
            chunk = a.recv(65536)
            if not chunk:
                break
            b.sendall(chunk)
    except OSError:
        pass
    for s in (a, b):
        try:
            s.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def tunnel(client):
    up = socket.create_connection(ECHO)
    threading.Thread(target=relay, args=(up, client), daemon=True).start()
    relay(client, up)


class Socks(socketserver.BaseRequestHandler):
    def handle(self):
        c = self.request
        _, n = read(c, 2)
        methods = read(c, n)
        if 2 not in methods:
            c.sendall(b"\x05\xff")
            return
        c.sendall(b"\x05\x02")
        read(c, 1)
        user = read(c, read(c, 1)[0]).decode()
        word = read(c, read(c, 1)[0]).decode()
        if (user, word) != ("kordal", "s3cret"):
            c.sendall(b"\x01\x01")
            return
        c.sendall(b"\x01\x00")
        _, cmd, _, kind = read(c, 4)
        name = read(c, read(c, 1)[0]).decode() if kind == 3 else socket.inet_ntoa(read(c, 4))
        port = struct.unpack(">H", read(c, 2))[0]
        ASKED.append(["socks", kind, name, port])
        c.sendall(b"\x05\x00\x00\x01" + bytes(6))
        tunnel(c)


class Http(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline().decode()
        head = {}
        while True:
            h = self.rfile.readline().decode().strip()
            if not h:
                break
            k, v = h.split(":", 1)
            head[k.lower()] = v.strip()
        ASKED.append(["http", line.split()[1]])
        if head.get("proxy-authorization") != "Basic " + base64.b64encode(b"kordal:s3cret").decode():
            self.wfile.write(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
            return
        self.wfile.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
        tunnel(self.request)


socks = Server(("127.0.0.1", 0), Socks)
http = Server(("127.0.0.1", 0), Http)
for s in (socks, http):
    threading.Thread(target=s.serve_forever, daemon=True).start()
SOCKS = {"type": "socks5", "host": "127.0.0.1", "port": socks.server_address[1], "username": "kordal", "password": "s3cret", "name": "PL"}
HTTP = {"type": "http", "host": "127.0.0.1", "port": http.server_address[1], "username": "kordal", "password": "s3cret", "name": "Home"}


def said(p, host="shop.example"):
    """What a connection through p to host gets back, or the ProxyDown's words."""
    try:
        s = launcher.through(launcher.clean_proxy(p), host, 443)
        s.sendall(b"hi")
        answer = s.recv(100).decode()
        s.close()
        return answer
    except launcher.ProxyDown as exc:
        return f"down: {exc}"


out["socks"] = said(SOCKS)
out["socks_name"] = ASKED[-1]
out["socks_wrong"] = said({**SOCKS, "password": "nope"})
out["http"] = said(HTTP)
out["http_target"] = ASKED[-1]
out["http_wrong"] = said({**HTTP, "password": "nope"})
dead = free_port()
out["dead"] = said({**SOCKS, "port": dead})
try:
    launcher.clean_proxy({"type": "ftp", "host": "x", "port": 1})
    out["bad_type"] = "taken"
except ValueError:
    out["bad_type"] = "refused"

# botdot's op: kept for this bot only, its login readable by the browser user alone, and its forwarder listens.
launcher.PROXY_PORT = free_port()
out["taken"] = launcher.take_proxy(SOCKS)
out["file_mode"] = oct(stat.S_IMODE(os.stat(launcher.PROXY_FILE).st_mode))
out["reloaded"] = launcher.load_proxy() == launcher.clean_proxy(SOCKS)
launcher.BOT = "other"
out["other_bot"] = launcher.load_proxy()
launcher.BOT = "hunter"


def forwarded(host=b"news.example"):
    c = socket.create_connection(("127.0.0.1", launcher.PROXY_PORT), timeout=5)
    c.sendall(b"\x05\x01\x00")
    assert read(c, 2) == b"\x05\x00"
    c.sendall(b"\x05\x01\x00\x03" + bytes([len(host)]) + host + struct.pack(">H", 443))
    reply = read(c, 10)
    if reply[1] != 0:
        c.close()
        return f"refused {reply[1]}"
    c.sendall(b"hello")
    answer = c.recv(100).decode()
    c.close()
    return answer


out["forwarded"] = forwarded()
out["forwarded_name"] = ASKED[-1]


def as_http(head):
    c = socket.create_connection(("127.0.0.1", launcher.PROXY_PORT), timeout=5)
    c.sendall(head)
    data = b""
    while True:
        chunk = c.recv(4096)
        if not chunk:
            break
        data += chunk
        if head.startswith(b"CONNECT") and data.endswith(b"\r\n\r\n"):
            c.sendall(b"ping")
            data += c.recv(100)
            break
        if b"echo:" in data:
            break
    c.close()
    return data.decode()


out["http_connect"] = as_http(b"CONNECT shop.example:443 HTTP/1.1\r\nHost: shop.example:443\r\n\r\n")
out["http_get"] = as_http(b"GET http://shop.example/a?b=1 HTTP/1.1\r\nHost: shop.example\r\nProxy-Connection: keep-alive\r\n\r\n")
out["http_get_name"] = ASKED[-1]

# A start through it: the forwarder, DNS and WebRTC at the proxy, and the proxy's address for geoip.
launcher.exit_ip = lambda p, seconds=8: "198.51.100.9"


def start():
    runner = threading.Thread(target=launcher.run_browser, args=("about:blank",), daemon=True)
    runner.start()
    for _ in range(100):
        if launcher.browser_open.is_set():
            break
        time.sleep(0.05)
    return runner


runner = start()
given = sync_api.LAUNCHES[-1]
prefs = given["firefox_user_prefs"]
out["launch_proxy"] = given.get("proxy")
out["launch_geoip"] = given.get("geoip")
out["prefs"] = {k: prefs.get(k) for k in ("network.proxy.socks_remote_dns", "network.trr.mode", "media.peerconnection.ice.proxy_only")}
# Another proxy while it runs: the browser closes, so its next open starts on the new one.
out["changed"] = launcher.take_proxy(HTTP)["proxyTaken"]
runner.join(5)
out["closed_on_change"] = not runner.is_alive() and not launcher.browser_open.is_set()

# A proxy that doesn't answer: nothing starts, and the start says why.
def down(p, seconds=8):
    raise launcher.ProxyDown("didn't answer (ConnectionRefusedError)")


launcher.exit_ip = down
launches = len(sync_api.LAUNCHES)
try:
    launcher.run_browser("about:blank")
    out["down"] = "started"
except launcher.ProxyDown as exc:
    out["down"] = str(exc)
out["down_launches"] = len(sync_api.LAUNCHES) - launches

# No proxy any more: the file goes, the forwarder lets nothing out, and the browser starts as before.
out["cleared"] = launcher.take_proxy(None)
out["file_gone"] = not os.path.exists(launcher.PROXY_FILE)
out["forward_without"] = forwarded()
runner = start()
out["plain_proxy"] = sync_api.LAUNCHES[-1].get("proxy")
sync_api.CONTEXTS[-1].pages = []
runner.join(5)
print(json.dumps(out))
