# ADR-251: A bot's ssh-agent socket is in a folder only that bot may enter

- **Status:** Accepted (2026-11-15)
- **Owning task:** security review M1 (2026-11)
- **Supersedes:** the "Reachable by that run alone" point of [ADR 087](087-a-script-job-signs-with-ssh-keys-through-botdots-own-agent.md)

## Context

ADR 087 put every run's ssh-agent socket in one folder of the server's that anyone may pass through but nobody may list (`0711`), under a random name, with the socket itself `0666`. The name was the only wall. It is no secret: `/proc/net/unix` shows the path of every bound socket to every user, so any bot with a shell, or a bot steered by a page it read, could point `SSH_AUTH_SOCK` at another bot's socket and sign with that bot's Vault SSH keys. This was seen live on 2026-11-15.

## Decision

- **A folder for each bot.** Where bots run as their own users, a bot's agent sockets are in `data/agents/<uid>`: the server's user owns it, its group is the bot's, mode `0710`. The server makes and removes the sockets there; the bot's user may pass through to its own socket; every other user is refused at the folder, whatever name it knows. `data/agents` itself is the server's, `0711`.
- **The broker makes it.** With the privilege broker, its `prepare` makes both folders (it alone may give a folder the bot's group) and answers the folder's path as `agents`. A botdot that runs as root makes them itself (`identity.agentDir`). Where everything runs as one user (local development), nothing changes: the shared folder of ADR 087.
- **Not data.** `data/agents` holds only live sockets: it is left out of backups and of the start's lock-down of the data folder.

## Alternatives

- Checking the caller's uid on each connection (`SO_PEERCRED`): Node.js doesn't expose it without a native module.
- The socket `0600` and owned by the bot's user: the server's user can't give a file away without root.
- A folder in the bot's home: the server's user can't make a socket there.

## Consequences

- A bot reaches only its own runs' agents, by the file system, not by a secret name.
- A test as root checks that another bot's user gets `EACCES` on the socket, and that the bot itself connects.
