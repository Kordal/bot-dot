# ADR-152: gVisor sizes an account's sandboxes by its share

- **Status:** Accepted
- **Amends:** [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) (runsc's flags in a rootless Docker)

## Context

Each account's Docker runs gVisor with `--ignore-cgroups` (ADR 028): runsc cannot make cgroups in a rootless Docker. runsc sizes a sandbox from its cgroup, so without one it tells the sandbox the machine's RAM (`/proc/meminfo`, MemTotal) and runs it on every CPU the process may use (`runtime.NumCPU`, its CPU affinity). An account whose share is 9 GB and 4 CPUs, on a 16 GB machine with 8 CPUs, had a computer that saw 16 GB and 8 CPUs. Tools that size themselves by that (Chrome, Hyperframes, `make -j`, Node's workers) ran past the share and were ended at its limit (the unit's MemoryMax), or crowded 8 threads into 4 CPUs of quota.

runsc's `--total-memory` and `--cpu-num` are flags of its internal `boot` command, which runsc fills itself from the cgroup or the machine: neither can be set in `daemon.json`.

## Decision

- **An account's Docker runs gVisor through a script of root's beside its share** (`accounts/<name>/share/runsc`, written by install.sh's `share`), named as the runtime's path in `daemon.json`, with the same flags.
- **As a sandbox is made** (`create`, `run`, `restore`), the script reads `share.json` and:
  - runs runsc in a mount namespace of its own, where `/proc/meminfo` is the machine's with MemTotal set to the share's RAM: runsc passes that to the sandbox, and the sandbox's `/proc/meminfo` and tmpfs sizes follow it;
  - runs it on as many CPUs as the share (`taskset`), starting at a place picked from the account's name, so that accounts spread over the machine. The account's CPU quota on its unit stays what holds it to its share.
- **Any other call** (`state`, `exec`, `kill`, `delete`…), a share no smaller than the machine, no `share.json`, or a machine without `unshare` or `taskset`, is runsc as it is. A namespace that can't be made, or a mount that fails, leaves the RAM as runsc reads it.
- A changed share applies from the sandbox's next start, as its other limits do (#108).

## Alternatives

- **runsc without `--ignore-cgroups`.** It would read the cgroup itself, but cannot make one in a rootless Docker (ADR 028, spike).
- **`--total-memory` in `daemon.json`.** Not a flag runsc takes there; only its `boot` command has it.
- **lxcfs.** A FUSE daemon per machine for one number runsc reads once per sandbox.
- **Only the RAM.** The CPU count is what tools size their threads by; with no pinning runsc reports every CPU.

## Consequences

- An account's sandboxes run on a fixed set of CPUs. Two accounts whose sets overlap share those CPUs while others are idle; the account's name picks where its set starts, so most don't.
- The first update with this restarts each account's Docker (its `daemon.json` changes), so its server and computer start again once.
- The script is the account's, as its `daemon.json` is: the account's user could change either, and gains nothing it didn't have.
