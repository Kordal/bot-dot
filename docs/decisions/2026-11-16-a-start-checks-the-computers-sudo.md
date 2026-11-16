# A start checks that the computer's sudo works, and only says so when it does not

On 16 November 2026 an apt upgrade on hq took gVisor's runsc from 20261012.0 to 20261026.0. Each computer lost `sudo` at its next start ("effective uid is not 0 ... nosuid"), although its files, its mounts and no-new-privileges were all fine, and a fresh container of the same image failed the same way. Tailscale and installs stopped working, and a reset of the computer was offered as the cure, which erases files and fixes nothing.

Each start now runs `sudo -n true` as `box` and logs the cause if it fails: the runtime does not honour setuid, install the runsc release botdot is tested with (`install.sh` names it) and restart. The start is not refused: the computer is otherwise sound, and its files and bots can still be reached.

Rejected: refusing the start (the owner could no longer open the computer's files), and trying to fix it from inside (the cause is the host's runsc, not the computer).
