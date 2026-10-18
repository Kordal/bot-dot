# Install with Docker Compose (Dokploy)

`compose.single.yaml` runs botdot as one Compose app on a Docker host that already has its own reverse proxy and HTTPS, such as [Dokploy](https://dokploy.com), Coolify or Portainer. Use it when the machine isn't botdot's alone. On a server of its own, [Install on Linux](install-linux.md) gives you more.

## What you get, and what you don't

- **One account.** Its passkey is made with a setup key you choose. There are no sign-up links, no more accounts and no admin page.
- **No gVisor walls.** The docker-helper gets the host's Docker socket, so the bots' computers run beside the host's other containers. [What bots can reach](what-bots-can-reach.md) assumes the Linux install's walls, and here they are missing.
- **Updates by redeploying.** botdot's own updater is off, and the images are not checked against botdot's release key as `install.sh` checks them. To pin a release, set `BOT_DOT_IMAGE` to its digest.
- **Data in named volumes** (`bot-dot-data`, `bot-dot-config`, `bot-dot-home`, `front-door-data`), which a redeploy keeps. Back them up with the host's own volume backups.

## Dokploy

1. **Create the app.** In a project, create a **Compose** service.
   - Provider **Git**: `https://github.com/Kordal/bot-dot.git`, branch `main`, compose path `./compose.single.yaml`.
   - Or provider **Raw**, with the file's contents pasted in.
2. **Environment.** In the service's **Environment** tab:
   ```
   FRONT_DOOR_ORIGIN=https://botdot.example.com
   FRONT_DOOR_SETUP_KEY=<the output of: openssl rand -base64 48 | tr '+/' '-_' | tr -d '='>
   TZ=Europe/Warsaw
   ```
   If botdot's images on ghcr.io are private, also add a registry under **Registry** (ghcr.io, your GitHub name and a token that may read packages), and set `BOT_DOT_REGISTRY_TOKEN=<that token>` so bots' computers can be downloaded.
3. **Domain.** Point the domain's DNS at the server. Then, in the **Domains** tab, add the host `botdot.example.com`, service `front-door`, port `4700`, with HTTPS and Let's Encrypt.
4. **Deploy.** When it is up, open `https://botdot.example.com/sign-up/<your setup key>` and make your passkey. The key opens nothing once the passkey exists.
5. **Sign in to Claude** on the setup page, then ask the Chief of Staff for your first bot.

The Android app signs in with the same passkey: give it `https://botdot.example.com`.

**To update**, press **Redeploy**. Every image is pulled again (`pull_policy: always`), and the volumes stay.

## Any other Docker host

Put `compose.single.yaml` next to a `.env` with the settings above. Then route your proxy's HTTPS for the domain to the `front-door` service on port 4700, on a network the proxy shares with it, and run `docker compose -f compose.single.yaml up -d`. The front door trusts the last `X-Forwarded-For` address the proxy adds (`FRONT_DOOR_BEHIND_PROXY`), so publish no port of it: only the proxy may reach it.
