# A local botdot server on a Mac runs in Docker

When the Mac app sets up botdot on the user's own Mac, it runs the same published images in Docker that `install.sh` uses on Linux. It does not bundle Node and run the server natively. With Docker, bots running `claude -p` with shell access are kept away from the user's home folder, the bots' computers already need Docker, and there is one tested setup and update path (the server updates itself through the Docker socket). The cost is a large dependency: the user must have Docker Desktop, OrbStack or Colima, and the app can only point them to the Docker Desktop download.

## Consequences

Security refinement, 29 September 2026: self-update and bot-computer operations
use a separate Docker helper with a fixed operation set. Only that helper mounts
the Docker socket. The HTTP server runs as UID 60000; a small root supervisor
launches bot processes under their assigned UIDs. This preserves the Docker
hosting decision while removing host Docker authority from the HTTP process.
See [server privilege separation](../security-nonroot-acceptance.md).

The Linux `compose.yaml` uses host networking, which Docker Desktop on a Mac doesn't provide the same way. So a Mac-hosted botdot needs its own compose file that publishes port 4747 on 127.0.0.1 only, and the server's self-update must refresh that file rather than the Linux one.

On Docker Desktop, every container can reach a port published on the Mac's 127.0.0.1 through `host.docker.internal`, and such a request arrives from the same bridge address as one from the Mac itself. So a bot, or its computer, could call botdot as its owner, and could forge the Tailscale login header too. A local botdot server therefore accepts owner requests only with an **owner key**, a secret that the Mac app creates and keeps in a private file in the install folder, next to the `.env` that hands it to Docker. Not in the Keychain: until the app is signed with a developer account, every update is signed differently, and macOS would ask for the Mac's password to let the updated app read its own item. A browser on the Mac gets it through an "Open in browser" link from the app, and a phone gets it once, by pairing. We rejected firewall rules against `host.docker.internal` as too fragile, because Docker Desktop always provides it. Linux installs, where requests from the machine are told apart by their user, don't need the key.
