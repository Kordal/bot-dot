# Selkies as the screen's transport

Findings of the trial ticket [#1737](https://github.com/ladrok/bot-dot/issues/1737), for the spec [#1732](https://github.com/ladrok/bot-dot/issues/1732) (botdot's own screen viewer). Written 2026-11-25.

**Status: desk research and a prepared trial. Nothing was run.** This machine has no Docker and no runsc, so every claim about gVisor, CPU, memory, bitrate and latency below is read from sources or is an open measurement, and says which. Running on an account's computer needs the owner's go; the exact steps are in [the trial steps](#the-trial-steps).

## Recommendation

**No-go for building a Selkies transport behind the viewer now. Go for the trial** (two minutes of probe first, then an hour on a throwaway computer), because it is the only way to turn the open questions below into numbers, and its first step can end the idea cheaply.

Why not build it yet:

1. **The way into a gVisor computer is unproven, and there is no second way.** pixelflux, Selkies' capture library, can only read an X display through MIT-SHM (System V shared memory). If that fails under runsc, nothing in Selkies captures our TigerVNC displays. The sources say it should work; nobody has run it (no gVisor issue and no Selkies issue mentions the other).
2. **A watched, idle screen is not free.** On the shared-memory path pixelflux grabs the whole 1280x800 frame on every frame-timer tick, changed or not; damage reports only bring a tick forward. TigerVNC sends nothing when nothing changes. Selkies' own numbers are for motion (1080p at 60 fps in under one core), not for a screen that sits still behind a bot's browser, which is most of the time.
3. **Selkies is an application, not a transport.** Its client is over 17,000 lines of TypeScript (the three main files alone) that own the picture, the keyboard, the pointer, the touch controls and the clipboard. It cannot sit behind "frames drawn to a canvas, input in, clipboard in and out" without either owning the page (an iframe) or being rewritten as our own client of its undocumented protocol. #1732's viewer exists to own those things.
4. **It moves fast.** 2.0.0 (2026-09-24) to 2.2.1 (2026-11-04) in six weeks; main is a Rust rewrite (2.3.0, unreleased); the WebSocket address is the same in both, but the rest of the wire protocol was read in 2.3.0 only, and the project says it needs maintainers.

What would change this: the thresholds in [the decision table](#decision-table). If they pass, prefer the third option below (pixelflux alone, our own small server and our own client), not Selkies' client.

## Which Selkies

The ticket names 2.0.0. It is not the current one.

| Release | Date | What it is |
| --- | --- | --- |
| 2.0.0 | 2026-09-24 (tag commit) | Python server, pixelflux and pcmflux as Rust extensions; WebSockets by default, WebRTC opt-in |
| 2.2.1 | 2026-11-04 | **Latest stable.** Same shape, pixelflux 2.2.3. The trial pins this one |
| 2.3.0 | not released | On `main`: one Rust executable, pixelflux and pcmflux linked in, the web client compiled into it. Per-commit prereleases exist (`f956c26`, 2026-11-25) |

The facts below hold for 2.2.1 unless a line says 2.3.0. Where both were read they agree.

## Capture under gVisor

**Question:** does pixelflux's capture work on a TigerVNC display inside a gVisor computer, by XShm or by a fallback?

**What the source says**

- pixelflux tries DRI3, then NvFBC (both need a GPU), then **XShm**. With no GPU the capture is XShm, and `stream_info()` reports it as `capture: XShm` ([`x11/mod.rs`](https://github.com/selkies-project/pixelflux/blob/2.2.3/pixelflux/src/x11/mod.rs), `run_capture`).
- **There is no fallback below XShm.** `run_shm_capture` asks the server for MIT-SHM (`shm_query_version`, error "XShm unavailable") and then makes three surfaces with `shmget(IPC_PRIVATE, size, IPC_CREAT|0600)` and `shmat`, attaches each to the X server with `shm_attach`, and removes it with `shmctl(IPC_RMID)` once both have it. A failure at any step ends the capture with an error ("shmget failed", "shmat failed", "shm_attach check"). A plain `GetImage` appears only in the screenshot helper and as a one-pixel sync in the DRI3 path. Selkies' Wayland backend is no way out: it runs its own compositor and cannot capture an X display that exists.
- It also needs a 32-bit-per-pixel root (`require_32bpp`), and uses XFixes (cursor) and DAMAGE (to wake early). Without DAMAGE it runs on its timer alone.
- Selkies' `.deb` depends on `libxcb-shm0`, which fits.

**What gVisor says**

- gVisor implements System V shared memory in its sentry ([`pkg/sentry/kernel/shm`](https://github.com/gvisor/gvisor/blob/master/pkg/sentry/kernel/shm/shm.go)). Its [syscall table](https://gvisor.dev/docs/user_guide/compatibility/linux/amd64/) lists `shmget`, `shmat` and `shmctl` as partial: no `SHM_HUGETLB`, no `SHM_RND`, no `SHM_LOCK`/`SHM_UNLOCK`. pixelflux uses none of them. The same table is published for arm64.
- gVisor's own tests cover the pattern pixelflux uses: attach to a segment already marked removed while it has references (`AllowsAttachToRemovedSegmentWithRefs`), destroy on the last detach (`RemovedSegmentsAreDestroyed`), and a second `IPC_RMID` not destroying an attached segment ([`test/syscalls/linux/shm.cc`](https://github.com/gvisor/gvisor/blob/master/test/syscalls/linux/shm.cc)).
- One recent change touches this: gVisor [#14191](https://github.com/gvisor/gvisor/issues/14191), fixed by #16263 (2026-10-23), makes `IPC_RMID` require the segment's creator, owner or `CAP_SYS_ADMIN`, as Linux does. pixelflux creates and removes as the same user, and the X server attaches as that user, so it passes **if Selkies runs as `box`, like Xvnc**. A Selkies run as root against box's Xvnc would be refused by Linux itself (the segment is 0600). Whether an account's runsc has the change depends on its release (`lib/computers.js` names `20261026.0`, three days after the fix); an older one checks nothing and breaks nothing. Open [#16864](https://github.com/gvisor/gvisor/pull/16864) (making removal visible atomically) does not touch it.
- Searches of both trackers found **no report of MIT-SHM or XShm failing in gVisor, and none of Selkies in gVisor**: no evidence against, none for.

**Verdict: probably works, not run.** The memory is shared between processes in one sandbox, the calls are supported, and X server and capture are in one computer and one IPC namespace (`docker exec` joins it). Three things still need a look on a real computer: that Xvnc lists `MIT-SHM` (it is built from X.Org's standard extension table, `mi/miinitext.c`, but its source has no word of it), that its root is 32 bits, and that pixelflux's start-up probes (GPU nodes, a forked encoder probe, `dlopen` of GPU libraries that are not there) fail soft under runsc. `xdpyinfo` and [`pixelflux-probe.py`](selkies-trial/pixelflux-probe.py) answer all of it in one short run, without Selkies' server.

If XShm fails there is no switch to flip. The only ways on are a patch of pixelflux to use `GetImage` (a 4 MB frame through the X socket every tick) or stopping.

## CPU, memory and bitrate per watched screen

**Not measured.** What is known:

- **Vendor claim:** "60 frames per second at 1080p with software encoding on less than 100% CPU" ([`docs/design.md`](https://github.com/selkies-project/selkies/blob/main/docs/design.md)). That is a moving picture with twice the pixels of ours and twice the rate we need, so the number to expect at 1280x800 and 30 fps is well under one core while something moves. No vendor figure exists for a still screen.
- **The still screen is the weak point.** On the XShm path "every tick is sent" (the pacing code, `pace.rs`): the capture does a full `shm_get_image` of 1280x800x4 = 4.1 MB per tick, and the encoder hashes each stripe to find that nothing changed. At 30 ticks a second that is 123 MB/s of copying and hashing inside gVisor for a screen nobody touches. pixelflux's "a static screen costs nothing" is said of its Wayland host-capture paths; for XShm the pacing code says every tick is sent. Measure it, and measure it at 10 to 15 frames a second too.
- **Rate control:** CBR at 8000 kbit/s by default with congestion control; software H.264 (x264) full frames or striped; JPEG stripes as a client fallback. A mostly still screen sends little (a cleanup frame after each change, "paint-over").
- **Memory:** one Selkies process per screen (it attaches to one `DISPLAY`), up to 89 screens per computer (`MAX_SCREENS`). The 2.2.1 `.deb` is a Python 3.12 environment with uvloop, cryptography and the encoders in it; its resident size is unknown to me and must be measured. For scale, a bot's screen is already 184 MB (TigerVNC, xfwm4 and a terminal; the note in `deploy/desktop/botdot-xstartup`). The process should start when someone watches and stop when the last viewer leaves, never one per seat all day.

What the trial measures, for Selkies and for the screen's VNC (noVNC through websockify) side by side, on the same 1280x800 screen:

| Measure | How | Scenarios |
| --- | --- | --- |
| CPU per program | `measure.py` in the computer (per program, 1 s) | idle desktop, the moving pattern, Camoufox scrolling a long page, typing, nobody watching |
| CPU of the whole sandbox | `docker stats --no-stream` on the host, every 5 s (counts gVisor's own cost, which the first does not) | the same |
| Memory | `measure.py` resident MB per program; `docker stats` | the same, plus 1, 2 and 4 screens watched |
| Bitrate | `trial-relay.cjs` prints kbit/s both ways every 5 s; Selkies' stats panel | the same |
| Frame rate and encode time | Selkies' stats panel; `pixelflux-probe.py` (capture-to-encoded time per frame) | moving |
| Latency to the eye | the computer's wall clock drawn by `pattern.py` beside the viewer's own clock in one screenshot (NTP-synced both ends); optional 240 fps phone video of a key press and its echo | moving, over Tailscale and on the same machine |
| Smoothness | the same pattern at 30 fps in both, a long page scrolled by hand | moving |
| Start to first picture | stopwatch from opening the viewer | cold and warm |
| Two viewers of one screen | the page's live screen and the picture-in-picture at once: does CPU double, does one kick the other? (Selkies: a second page joins as a controller beside the first) | moving |

## Does it pass through botdot's relay over Tailscale unchanged?

**The bytes, yes; the routing needs a small change.**

- The relay is a raw byte pipe. `screenSocket` in [`server.js`](../../server.js) accepts a WebSocket upgrade at `/computer/<botId>/websockify`, rewrites only the `Host` and `Origin` headers to `127.0.0.1:6080`, and `screenPipe` in [`lib/computers.js`](../../lib/computers.js) carries every byte through `docker exec -i python3` to `127.0.0.1:<novnc port>` in the computer. It never reads a frame, so any protocol over WebSocket passes, binary and large frames included. The `Origin` and `Host` it writes agree, which is what Selkies' origin guard asks for with no `--allowed-origins`.
- **Changes it needs:** (1) the address check accepts only `/websockify`; Selkies' socket is `/api/websockets` (under `--subfolder`, that prefix first), so the check must accept a second path or the page must ask for `/websockify` and the relay rewrite it by the bot's transport; (2) `screenPorts` has no Selkies port: the trial uses `6200 + n`, beside websockify's `6100 + n`; (3) the process must be started on demand. Nothing in the relay's own code changes.
- **Tailscale** is the hop between the owner's browser and the front door. The relay adds no framing there, so it is the same hop VNC takes. Open points, all measured by the trial: a stalled TCP stream holds up an H.264 stream until its next key frame, where VNC loses one rectangle (Selkies has acks, `LOST_FRAME` and congestion control for exactly this); the pipe through `docker exec` under runsc may add buffering and latency (Selkies' ack-based gating measures the round trip it sees, so it adapts); and the picture needs WebCodecs, which only a secure context has: botdot's page over HTTPS is one, plain HTTP on a tailnet address is not (the client then falls back to JPEG stripes).
- **Safety is the same as today.** Selkies listens on `127.0.0.1` inside the computer with basic auth off, as the VNC port is open there with no security (`-SecurityTypes None`); the owner's check is at the relay. A bot on the computer can reach either. One gain is available: Selkies can enforce view-only on the server (`--basic-auth-viewonly-password`, or a viewer role) where today noVNC's `viewOnly` is a client flag, if the relay presents the credential for `view_only=1`.

## Input, clipboard, and the bots' own control

Read from sources; to be checked in the trial.

- **Input** goes in through XTEST (python-xlib in 2.2.1, x11rb in 2.3.0) on the same display, as computer-server's own `pyautogui` does. Nothing there is exclusive, so a viewer and a bot can both type. The trial confirms it by running a screenshot and a click through computer-server while a viewer is connected.
- **Clipboard** is two-way, text and images, synced through XFixes on the X selections (`--clipboard-seamless` is on by default). TigerVNC's own clipboard bridge only acts while a VNC viewer is connected, so the two should not fight; check it by having both open once.
- **Side effects on the bot's session.** `--enable-resize` is on by default and would change the screen's size to the browser window's: the trial turns it off, because the bots' screenshots, clicks and the browser's window depend on 1280x800 ([PR #1731](https://github.com/ladrok/bot-dot/pull/1731)). DPI, cursor theme and size settings can also be written by a client; the trial diffs `xrandr`, `xrdb -query` and `xfconf-query` before and after a viewer connects. Selkies also ships its own "Computer Use" and Pelorus (an agent) endpoints; both are off unless configured and must stay off.
- **A Mac client's Command key is sent as Control by default** (`--mac-cmd-as-ctrl`): a choice Selkies makes for the owner, in the client.
- **Not carried:** touch gestures like #1732's (Selkies has its own), "Type it", the keys menu, and a file dropped to the bot's folder (Selkies has an upload to one folder) are not ours; they would be rebuilt or dropped.

## Licence and image size

- **Licence.** Selkies and pixelflux are MPL-2.0: file-level copyleft, nothing for botdot's MIT code if Selkies stays a separate program in the computer. The same holds for noVNC, already in [`NOTICE`](../../NOTICE). **GPL:** the official wheels and `.deb` link libx264 and x265 (GPL-2.0-or-later); the `.deb` carries a 14.8 MB `libx265`. A GPL-free build exists (`PIXELFLUX_ENABLE_GPL=0`, OpenH264 and kvazaar), built from source, losing only 4:4:4 colour, which the screen does not need ([`docs/licensing.md`](https://github.com/selkies-project/selkies/blob/main/docs/licensing.md)). botdot publishes `bot-dot-desktop` to a registry, so shipping the official build means a GPL notice in `NOTICE` and the source offer. Whether that is acceptable is the owner's call, and this is not legal advice.
- **Size.** The 2.2.1 `.deb` for Ubuntu 24.04, the base of the desktop image: **53.1 MB** to download (amd64; 51.4 MB arm64), **253 MB installed** (253,410 KiB per its control file; 259 MB in the archive), plus a few small system libraries (`libva2`, `libgbm1`, `libegl1`, `libwayland-server0`, `libpixman-1-0`, `libxcb-shm0`). Largest parts: uvloop 16 MB, libx265 15 MB, cryptography 14 MB, pixelflux 13 MB, SVT-AV1 7.6 MB, and six 6 MB audio libraries. The 2.3.0 prerelease is one binary: 46.4 MB (x86_64) and 44.4 MB (aarch64) as a `.tar.gz`. The size of the desktop image today is not known here (no Docker); compare with `docker image ls` before and after the trial layer.
- Sources for both: the release's `SHA256SUMS`, the `.deb`'s `control` file, and the release assets list, read on 2026-11-25.

## How a Selkies transport plugs into the viewer's transport interface

#1732's interface: connect, disconnect, frames drawn to a canvas, pointer and key input, clipboard in and out, state events. RFB is the first implementation. Three ways to add Selkies, cheapest first.

| | A. Selkies' client in an iframe | B. Our client for Selkies' protocol | C. pixelflux alone, our server and our client |
| --- | --- | --- | --- |
| What runs in the computer | `selkies` per screen | `selkies` per screen | a small Python program on pixelflux (as `example/screen_to_browser.py`), per screen |
| What runs in the page | Selkies' compiled core (`web/selkies-web-core`, served by Selkies or from `vendor/`) in a same-origin iframe, driven by `postMessage` | our code: WebSocket, `VideoDecoder`, draw to the viewer's canvas | our code, with a protocol we define |
| connect/disconnect | create or remove the iframe at `/computer/<id>/` | open the socket at `/api/websockets`, send `SETTINGS`, `START_VIDEO` | open our socket |
| Frames | drawn by Selkies into its own `<video>` or canvas: **the interface must let a transport own a surface**, not hand it a canvas | `0x04` full-frame H.264, as 2.3.0's client reads it (u8 codec/kind, u16 frame id, u16 y, u16 w, u16 h, u16 predicted-from, then the data) decoded by WebCodecs to the canvas; `CLIENT_FRAME_ACK` back | we choose: pixelflux can emit bare Annex-B frames (`omit_stripe_headers`) |
| Pointer, keys | Selkies' `lib/input.ts` (6,400 lines: layouts, pointer lock, Mac chords); the viewer's keys menu and "Type it" need its internals (`window.webrtcInput`), not a documented API | our code sends `m,…` `kd,…` `ku,…` text messages | our code and an XTEST injector (python-xlib is in the computer already) |
| Clipboard | `clipboardUpdateFromUI` in, `clipboardContentUpdate` out | `cw,…` / `clipboard,…` messages, chunked for large | ours |
| State events | `pipelineStatusUpdate`, `clientRoleUpdate`, `serverSettings`, `VIDEO_STARTED`; "Starting…", "Reconnecting…" stay ours, outside the iframe | ours, from the socket | ours |
| Cost | days, but we inherit its UI, its surprises and every release | about 1,000 lines; the wire is documented only in the docblock of one 10,800-line file and moves with the release | the most to write (a server, an injector, a client) and the least that is not ours |
| Risk | highest: two UIs, two sets of gestures | medium: protocol drift | lowest dependence on one project; pixelflux keeps its Python API and ships a wheel (15 MB) |

The relay change is the same in all three. **If the trial passes, build C**: pixelflux is the part that is worth having (capture, damage, H.264 and JPEG stripes, rate control), and #1732 wants the viewer to own everything else. A is the quickest demonstration and the one to try first on a throwaway screen if a person wants to see Selkies' picture beside noVNC's.

## Decision table

A proposal for the owner to change. All at 1280x800, one watched screen, software encoding, inside runsc, against the same screen's VNC.

| | Go on to a real build | Stop |
| --- | --- | --- |
| `pixelflux-probe.py` | `capture: XShm`, frames in both phases | any failure at shmget, shmat, shm_attach, or no frames |
| CPU, moving pattern at 30 fps | at most 60% of one core, and not more than VNC's plus 40 points | above 100% of one core |
| CPU, watched but still screen | at most 10% of one core at the frame rate we would choose (10 to 15) | above 25% at 10 fps |
| Memory | at most 120 MB for the process while watched, nothing when not | above 250 MB |
| Bitrate, moving | at most 4 Mbit/s; still screen under 100 kbit/s | still screen above 500 kbit/s |
| Latency to the eye | at least 30% below VNC's median at the same scene | worse than VNC |
| Side effects | none on size, DPI, theme; bots' screenshots and clicks unchanged; two viewers fine | any |

## The trial steps

Files are in [`selkies-trial/`](selkies-trial/): `selkies-trial.Dockerfile`, `run-selkies.sh`, `pattern.py`, `pixelflux-probe.py`, `measure.py`, `trial-relay.cjs` and, for Stage 2, `stage2.sh`. They were checked for syntax only; none was run. The desktop image must have 1280x800 screens (PR #1731). All commands run as one person on the machine, with `docker` pointing at the Docker the owner names.

### Stage 1: a throwaway computer, with the owner's OK for the machine

This touches no account and no account's data: a new container made like the account's computer, then removed. It needs the owner's go for the host and for the time.

```sh
cd docs/research/selkies-trial
docker build -f selkies-trial.Dockerfile --build-arg DESKTOP=bot-dot/desktop:latest -t bot-dot/desktop:selkies-trial .
docker image ls bot-dot/desktop            # the size before and after, for the record

# as lib/computers.js makes it (--runtime runsc is needless where the Docker's default already is): runsc, user box, 1 GB /dev/shm, init; the account's share for memory and CPUs
docker run -d --name selkies-trial --runtime runsc --user box -e HOME=/home/box --shm-size 1g --init --no-healthcheck \
  --memory 4g --memory-swap 4g --cpus 2 --entrypoint sleep bot-dot/desktop:selkies-trial infinity
docker exec selkies-trial mkdir -p /workspace/trial
# one bot's screen, as startScreen does it (screen 1: n = 11)
docker exec -d -u box -e HOME=/home/box -e SCREEN=11 -e SCREEN_DISPLAY=:11 -e VNC_PORT=5911 -e NOVNC_PORT=6111 \
  -e API_PORT=8111 -e WORKDIR=/workspace/trial selkies-trial /usr/bin/supervisord -n -c /etc/supervisor/botdot-screen.conf
```

**Step 1, the probe (2 minutes; stop here if it fails):**

```sh
docker exec -u box -e HOME=/home/box -e DISPLAY=:11 selkies-trial sh -c 'xdpyinfo | grep -E "MIT-SHM|DAMAGE|XFIXES|XTEST|RANDR|depth of root|bits_per_pixel|dimensions"'
docker exec -u box -e HOME=/home/box -e DISPLAY=:11 selkies-trial /opt/selkies/bin/python /opt/selkies-trial/pixelflux-probe.py 8 15
```

The probe measures the still phase first, on a screen nothing moves on, and then starts `pattern.py` itself for the moving phase and stops it at the end: do not start `pattern.py` before it. Expect `MIT-SHM` and `DAMAGE` listed, a depth-24 root with `depth 24, bits_per_pixel 32` (pixelflux needs 32 bits per pixel, not depth 32), `1280x800`, `stream_info` saying `capture: 'XShm'`, `encoder: 'x264'`, then a `still` and a `moving` line of rates and CPU and `PASS`. Keep the output.

**Step 2, Selkies' server and the comparison:**

```sh
docker exec -d -u box -e HOME=/home/box selkies-trial /opt/selkies-trial/run-selkies.sh 11      # EXTRA="--framerate=15" for the second pass
node trial-relay.cjs selkies-trial 6111 4851 &    # noVNC:   http://127.0.0.1:4851/vnc.html?autoconnect=1&path=websockify
node trial-relay.cjs selkies-trial 6211 4852 &    # Selkies: http://127.0.0.1:4852/
```

Open each in a 1280x800 browser window, one at a time and then both. For each scenario in the table above, start `docker exec -u box selkies-trial python3 /opt/selkies-trial/measure.py 60 <label>` (a tab-separated table per second) and, on the host, `docker stats --no-stream selkies-trial` five times. Note the relay's kbit/s lines. Watch `/tmp/selkies-11.log` (`docker exec selkies-trial tail -f /tmp/selkies-11.log`) for the capture path it names and any refusal.

The second pass sends the Tailscale leg through: on the trial machine run `tailscale serve --bg --https=8443 http://127.0.0.1:4852` (check `tailscale serve --help` for the flags of the installed version), open the tailnet name from the owner's laptop, repeat the moving scenario and the latency screenshots, and turn it off with `tailscale serve --https=8443 off`.

Checks for the bots' own control, with a viewer connected: a screenshot and a click through computer-server on port 8111 (`curl`, or botdot's `request`), the clipboard both ways, `xrandr`, `xrdb -query` and `xfconf-query -lv` before and after, two viewers at once, and what the process and the capture do when the last viewer leaves (it should stop).

**Clean up:** `docker rm -f selkies-trial`, `docker rmi bot-dot/desktop:selkies-trial`, stop the relay processes.

### Stage 2: one account's computer, only with the owner's go for that account

Only if Stage 1 passes the table, and only for the account and the hour the owner names. It checks what a throwaway cannot: a real bot's real browser load and the real front door and Tailscale path.

1. Pick a bot with a screen on the account's computer and note its screen number n (10 + its screen).
2. Copy the pinned `.deb` (to `/tmp/selkies.deb`) and the five scripts (`run-selkies.sh`, `pattern.py`, `pixelflux-probe.py`, `measure.py` and `stage2.sh`, into `/opt/selkies-trial/`) into the account's computer with `docker cp`, using the account's own Docker (`DOCKER_HOST` as botdot sets it for that account), then run `docker exec -u root <computer> /opt/selkies-trial/stage2.sh install`. It first writes the list of installed packages to `/var/lib/selkies-trial/` (not `/tmp`, which may be cleared), then runs `apt-get update` and installs the `.deb` with `x11-utils` and `x11-xserver-utils` (`xdpyinfo`, `xrandr` and `xrdb`, which the image may lack; if it has them, apt leaves them as they are). The computer changes in exactly these ways: the packages that list did not have (the Selkies package and the dependencies it pulls in), `/opt/selkies/`, `/opt/selkies-trial/`, `/tmp/selkies.deb`, apt's package lists and cache, `/var/lib/selkies-trial/`, and the trial's logs. Nothing else, and the undo takes those out.
3. Start Selkies for that screen only: `docker exec -d -u box -e HOME=/home/box <computer> /opt/selkies-trial/run-selkies.sh <n>`.
4. Reach it with `trial-relay.cjs` on the botdot server's machine, under that same `DOCKER_HOST`, bound to loopback and `tailscale serve` in front, not through botdot's own relay; **no change to `server.js`, `lib/computers.js` or the account's image**. The owner watches while the bot works.
5. Measure as in Stage 1, with the bot's real work.
6. **Undo:** kill `trial-relay.cjs`, run `tailscale serve --https=8443 off`, then `docker exec -u root <computer> /opt/selkies-trial/stage2.sh undo`. It stops `selkies`, purges only the packages that were not in the recorded list (never a package named in the script: `x11-xserver-utils` is the desktop image's own, `botdot-desktop` calls `xhost` from it, so a purge of it would break every bot's screen), runs no `autoremove`, stops without removing anything if that purge would also take out a package that was there before, and deletes `/opt/selkies`, `/opt/selkies-trial`, `/tmp/selkies.deb`, `/tmp/selkies-*.log`, apt's lists (only if they were empty before), the apt cache and `/var/lib/selkies-trial/`. Selkies writes only logs and, in its upload folder, files a client sends; none is sent. `undo` prints the packages it removes, so the owner sees that they are the trial's.

## Sources

Read on 2026-11-25, all primary:

- Selkies, `selkies-project/selkies`: tags `2.0.0` (`3ec56fb1`), `2.2.1` (`d6b93514`), `main` at `f956c260`; `docs/design.md`, `docs/settings.md`, `docs/licensing.md`, `docs/native.md`, `docs/usage.md`, `docs/secure-mode.md`, `release-notes/`; `web/selkies-web-core/` (`README.md`, `selkies-ws-core.ts` docblock); `crates/selkies/src/ws/` and `http/auth.rs` (`is_origin_allowed`); the 2.2.1 release's `SHA256SUMS`, asset list and `.deb`.
- pixelflux, `selkies-project/pixelflux`: tag `2.2.3` (`pixelflux/src/x11/mod.rs`: `run_capture`, `ShmSurface::create`, `run_shm_capture`, `wait_for_frame`; release notes), and its mirror of `main` at `f88cd68` (`README.md`, `src/pace.rs`, `src/x11/`).
- gVisor, `gvisor/gvisor`: `pkg/sentry/kernel/shm/shm.go`, `pkg/sentry/syscalls/linux/sys_shm.go`, `test/syscalls/linux/shm.cc`, `pkg/abi/linux/shm.go`; issues #14191 and #16263, pull request #16864; the [compatibility table](https://gvisor.dev/docs/user_guide/compatibility/linux/amd64/).
- TigerVNC, `TigerVNC/tigervnc`: `unix/xserver/hw/vnc/xvnc.c` and `Makefile.am` (Xvnc uses the server's `mi/miinitext.c`).
- botdot: `server.js` (`screenSocket`), `lib/computers.js` (`screenPorts`, `screenPipe`, `startScreen`, the `docker run` flags), `deploy/desktop/` (Dockerfile, `botdot-desktop`, `botdot-screen.conf`, `botdot-xstartup`), PR #1731.
