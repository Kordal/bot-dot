# Install with Docker Compose

`compose.single.yaml` runs botdot as one Compose app on any Docker host, whether a VPS with plain Docker or one managed by Dokploy, Coolify or Portainer. Use it when the machine isn't botdot's alone, or when you'd rather keep everything in Docker. On a Linux server of its own, [Install on Linux](install-linux.md) gives you more.

## What you get, and what you don't

- **One account.** Its passkey is made with a setup key you choose. There are no sign-up links, no more accounts and no admin page.
- **No gVisor walls.** The docker-helper gets the host's Docker socket, so the bots' computers run beside the host's other containers. [What bots can reach](what-bots-can-reach.md) assumes the Linux install's walls, and here they are missing.
- **Updates by pulling again.** botdot's own updater is off, and the images are not checked against botdot's release key as `install.sh` checks them. To pin a release, set `BOT_DOT_IMAGE` to its digest.
- **Data in named volumes** (`bot-dot-data`, `bot-dot-config`, `bot-dot-home`, `front-door-data`), which `up` and redeploys keep. Back them up with the host's own volume backups.

## What you need

- **Docker** with Compose v2, on Intel/AMD or ARM.
- **A domain** pointing at the host, served over **HTTPS**: a passkey works only on HTTPS, or on `localhost`. Either the host already has a reverse proxy that does this, or you use Caddy from `compose.single.caddy.yaml`.
- A **Claude subscription** (Pro or Max).

## Settings

Put these in a `.env` next to the compose files, or in the platform's environment settings:

```
FRONT_DOOR_ORIGIN=https://botdot.example.com
FRONT_DOOR_SETUP_KEY=<the output of: openssl rand -base64 48 | tr '+/' '-_' | tr -d '='>
TZ=Europe/Warsaw
```

| Setting | |
|---|---|
| `FRONT_DOOR_ORIGIN` | The address you open. A passkey belongs to its host name, so pick it once. Required. |
| `FRONT_DOOR_SETUP_KEY` | 32 to 100 base64url characters that open the one sign-up page until your passkey exists. Required. |
| `FRONT_DOOR_ACCOUNT` | Your account's name: 2 to 31 lowercase letters, digits and dashes, starting with a letter. Default `owner`. It can't be changed once your passkey is made. |
| `TZ` | The time zone schedules use. Default `UTC`. |
| `BOT_DOT_DOMAIN` | The host name in `FRONT_DOOR_ORIGIN`, for Caddy only. |
| `BOT_DOT_REGISTRY_TOKEN` | Only while botdot's images on ghcr.io are private: a GitHub token that may read packages, so bots' computers can be downloaded. Run `docker login ghcr.io` on the host too. |
| `BOT_DOT_IMAGE`, `BOT_DOT_COMPUTER_IMAGE` | Other images, such as a pinned digest or your own build. |

## Plain Docker

```bash
git clone https://github.com/Kordal/bot-dot.git bot-dot-source
cd bot-dot-source
# write .env as above
```

**Without a reverse proxy,** let Caddy take ports 80 and 443 and get the certificate. Add `BOT_DOT_DOMAIN=botdot.example.com` to `.env`, then run:

```bash
docker compose -f compose.single.yaml -f compose.single.caddy.yaml up -d
```

**With a reverse proxy already on the host** (Traefik, nginx, Caddy), route the domain's HTTPS to the `front-door` service on port 4700, on a Docker network the proxy shares with it. Then run:

```bash
docker compose -f compose.single.yaml up -d
```

A proxy outside Docker (nginx on the host, or Tailscale Serve) needs a port to reach. Add a `compose.override.yaml` next to the compose file with:

```yaml
services:
  front-door:
    ports: ["127.0.0.1:4747:4700"]
```

Then point the proxy at `http://127.0.0.1:4747`. Keep that port on `127.0.0.1`: the front door trusts the last `X-Forwarded-For` address it gets (`FRONT_DOOR_BEHIND_PROXY`), so only your proxy may reach it.

**To update,** run the same command with `pull` and then `up -d`:

```bash
git pull
docker compose -f compose.single.yaml [-f compose.single.caddy.yaml] pull
docker compose -f compose.single.yaml [-f compose.single.caddy.yaml] up -d
```

## Dokploy

1. In a project, create a **Compose** service.
   - Provider **Git**: `https://github.com/Kordal/bot-dot.git`, branch `main`, compose path `./compose.single.yaml`.
   - Or provider **Raw**, with the file's contents pasted in.
2. Put the settings in the **Environment** tab. If the images are private, also add ghcr.io under **Registry**. To pick your account's name, add `FRONT_DOOR_ACCOUNT` before the first deploy: 2 to 31 lowercase letters, digits and dashes, starting with a letter (default `owner`). It can't be changed once your passkey is made.
3. Point the domain's DNS at the server. Then, in the **Domains** tab, add the host, service `front-door`, port `4700`, with HTTPS and Let's Encrypt.
4. Deploy. **To update,** press **Redeploy**: every image is pulled again (`pull_policy: always`), and the volumes stay.

## Coolify and Portainer

- **Coolify:** create a Docker Compose resource from the repository with `compose.single.yaml`. Set the settings in its environment, and give the `front-door` service your domain on port 4700.
- **Portainer:** create a stack from the repository with `compose.single.yaml` and the settings as its environment variables. Then route your proxy to `front-door:4700`, or add `compose.single.caddy.yaml` as a second file.

## Two botdot apps on one host

Two Compose apps on one host work: create the app twice under different names, each with its own domain and setup key. Their data stays apart because the volumes take each app's project name. The bots' computers do too: each app names and labels them with its project, and lists, counts, stops and erases only its own. They still share the host's one Docker, so a flaw in one app's docker-helper reaches the other. For two people, use [Install on Linux](install-linux.md), where each account has a Docker of its own.

## First sign-in

1. Open `https://botdot.example.com/sign-up/<your setup key>` and make your passkey. The key opens nothing once the passkey exists.
2. Sign in to Claude on the setup page, then ask the Chief of Staff for your first bot.
3. The Android app signs in with the same passkey: give it `https://botdot.example.com`.
