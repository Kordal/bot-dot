# ADR-087: A script job signs with SSH keys through botdot's own agent

- **Status:** Accepted (2026-10-24)
- **Owning task:** [#525](https://github.com/Kordal/bot-dot/issues/525)

## Context

ADR 085 lets a script job call APIs with the Vault logins its job lists. A routine such as a morning infra review also needs SSH with a saved key. A bot's AI run has `run_with_ssh_key`, which loads the key into an ssh-agent in the account's computer (ADR 035). A script job runs on the botdot server, as its bot's user, where there was no SSH client and no way to use a Vault SSH key.

## Decision

- **The same list.** A script job's `logins` may name Vault SSH keys shared with its bot, with the same limit of 8 and the same approval as its logins (ADR 085).
- **botdot is the agent.** During a run of a job that lists logins, `SSH_AUTH_SOCK` points to a socket the botdot server serves itself for that run (`lib/ssh-agent.js`). It speaks the ssh-agent protocol, but only "list your keys" and "sign this": adding, removing and locking are refused. It signs with ed25519, RSA (SHA-2 and SHA-1) and ECDSA keys in the server's own process. The key is never in a file, an environment variable or a process of the bot's user, so the script and its programs cannot read it.
- **Read only when needed.** The agent fetches the keys from Bitwarden the first time the script's ssh asks, so a run that does not use SSH reads no key.
- **Reachable by that run alone.** The socket is in a folder of the server's that anyone may pass through but nobody may list (`0711`), under a random name that only the script's environment holds, and it is removed when the script ends.
- **The image gets `openssh-client`**, for `ssh` and `scp` in scripts.

## Alternatives

- **OpenSSH's own ssh-agent, run as the bot's user, as in the computer.** Rejected: the key would pass through a process of the bot's user, and another process of that user could read it while loading. The computer does this because every bot there has sudo anyway (ADR 035); the server keeps bots apart.
- **The key in a file for the run (`ssh -i`).** Rejected: the script could read or copy it.

## Consequences

- A script can use a key for as long as its run lasts, on any host the key opens. The owner sees which keys it lists on the card, as for logins.
- Keys of type DSA, or with a passphrase, can't be used by scripts (Bitwarden's are without one).
