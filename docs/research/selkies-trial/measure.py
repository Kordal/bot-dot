#!/usr/bin/env python3
"""CPU and memory by program, inside the computer, once a second (#1737, trial only).

  python3 measure.py <seconds> [label]  >> run.tsv

Groups: xvnc (the screen's X server), wm (xfwm4), selkies, websockify, computer-server, browser (camoufox, firefox),
pattern, other. CPU is a percentage of one core over the last second, read from /proc/<pid>/stat; memory is the
resident set, in MB, from /proc/<pid>/status. These are the numbers gVisor's sentry reports to the program: its own
cost, and the gofer's, are not in them. Take the host's view at the same time (`docker stats --no-stream`, or the
cgroup of the account's unit), which counts them.
"""
import os
import re
import sys
import time

GROUPS = [
    ("xvnc", re.compile(r"^Xtigervnc$|^Xvnc$")),
    ("wm", re.compile(r"^xfwm4$")),
    ("selkies", re.compile(r"/selkies(\s|$)")),
    ("websockify", re.compile(r"websockify")),
    ("computer-server", re.compile(r"computer_server")),
    ("browser", re.compile(r"camoufox|firefox")),
    ("pattern", re.compile(r"pattern\.py")),
]
TICKS = os.sysconf("SC_CLK_TCK")


def group_of(comm, cmdline):
    for name, rx in GROUPS:
        if rx.search(comm) or rx.search(cmdline):
            return name
    return "other"


def snapshot():
    out = {}
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            with open(f"/proc/{pid}/stat") as f:
                stat = f.read()
            comm = stat[stat.index("(") + 1:stat.rindex(")")]
            fields = stat[stat.rindex(")") + 2:].split()
            ticks = int(fields[11]) + int(fields[12])  # utime + stime
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmdline = f.read().replace(b"\0", b" ").decode("utf8", "replace")
            rss_kb = 0
            with open(f"/proc/{pid}/status") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        rss_kb = int(line.split()[1])
            out[pid] = (group_of(comm, cmdline), ticks, rss_kb)
        except (OSError, ValueError, IndexError):
            continue
    return out


seconds = int(sys.argv[1]) if len(sys.argv) > 1 else 30
label = sys.argv[2] if len(sys.argv) > 2 else "run"
names = [n for n, _ in GROUPS] + ["other"]
print("label\tsecond\t" + "\t".join(f"{n}_cpu%\t{n}_MB" for n in names), flush=True)
prev = snapshot()
for second in range(1, seconds + 1):
    time.sleep(1)
    now = snapshot()
    cpu, mem = dict.fromkeys(names, 0.0), dict.fromkeys(names, 0.0)
    for pid, (group, ticks, rss) in now.items():
        mem[group] += rss / 1024
        if pid in prev:
            cpu[group] += 100.0 * (ticks - prev[pid][1]) / TICKS
    prev = now
    print(f"{label}\t{second}\t" + "\t".join(f"{cpu[n]:.1f}\t{mem[n]:.0f}" for n in names), flush=True)
