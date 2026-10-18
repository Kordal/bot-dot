# What bots can reach (Docker installs)

In botdot's Docker image, botdot itself runs as root, the Chief of Staff as its own user, and **every bot as its own user**. Linux then enforces the boundaries, whatever tool a bot uses (Read, Bash, scripts):

| | botdot | Chief | A bot |
|---|---|---|---|
| botdot's data, the vault and its key, the Claude sign-in, Bitwarden | ✓ | – | – |
| The Docker socket (control of the machine) | ✓ | – | – |
| botdot's controls (create bots, settings, vault…) | ✓ | ✓ through its tools | – |
| Its own run's tools (memory, jobs, logins, apps, computer), with its own run key | | | ✓ |
| A bot's workspace | ✓ | read | its own only |

- **Claude:** the Chief and bots get only the short-lived access token from botdot's own sign-in (never the refresh token); botdot renews the sign-in before it runs out.
- **Run keys, and what a bot is told** (its instructions, its notes, the shared notes and its chat), are in private files of that bot's own user, not on the command line, where every user could read them. The file with what it is told is removed when the run ends.
- **Through Tailscale from the machine itself** (which Tailscale would vouch for as you), botdot refuses requests: only your other devices use the tailnet address.
- Programs on a bot's desktop are started by botdot, in that bot's computer only.
- **Programs on a bot's computer:** a bot installs what you ask for into its computer's home with `botdot-install` (conda-forge, pip, npm), without root. **Its computer on your tailnet:** a bot can run `botdot-tailscale up` in its computer, which puts it on your tailnet as a device of its own once you open its login link and approve it ([ADR 032](adr/032-a-bot-installs-programs-in-its-home.md)). It runs in userspace with shields up: the computer gets no root and no network rights, and no tailnet device can connect to it. It can then reach what your tailnet's access rules let that device reach, so give it a tag that limits it, and remove it in the admin console to cut it off.
- **Who is asking:** botdot looks up which user opened each connection from the machine itself (any of its addresses). When it can't tell for sure, it refuses the request.
- **The Chief on the web:** the Chief searches the web and reads pages itself. Once it has in a chat, what it changes there (bots, jobs, skills, the Board, groups, reminders, settings) waits for your OK on a card that shows exactly what it sent ([ADR 033](adr/033-the-chief-reads-the-web-and-what-it-changes-after-waits.md)). Reading a page is not held, so an address it fetches could carry something out; its instructions forbid putting your data in one.
- **Connectors:** a bot with an app's connector can ask for any of that app's actions, writing ones too; a write waits for your OK on its card, unless you chose **Always allow this action** for it. What its main assignment says it should do is guidance, not a limit.
- Turn it off with `BOT_DOT_SEPARATE_USERS=0`. On a Mac, everything runs as you, as before: a bot with Read or shell access can then read `data/memory.db` and the other bots' folders ([SECURITY.md](../SECURITY.md)).
