# ADR-037: A saved file is in the computer for the length of one command

- **Status:** Accepted (2026-10-20, the owner's decision on [#157](https://github.com/Kordal/bot-dot/issues/157): option A, 64 KB). Changes one sentence of [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md): botdot never put a secret in a file; a file of the Vault now is one, for one command.
- **Owning task:** [#157](https://github.com/Kordal/bot-dot/issues/157)

## Context

The owner wants to give the Vault secret files, a `.pem` first (a GitHub App key that signs a token, a client certificate), and other types later. A bot should use one in a command on the account's computer without the content reaching the model. Programs such as `openssl`, `curl --cert` or a GitHub App library read such a key from a path. Until now botdot handed a secret to the computer only in a command's environment (`run_with_login`) or into an ssh-agent (`run_with_ssh_key`), and [SECURITY.md](../../SECURITY.md) and ADR 035 said that it never put one in a file.

## Decision

- A file is an item of the Vault of its own kind, `file`, kept in the owner's Bitwarden only, as SSH keys are: a secure note of the bot-dot folder whose hidden fields hold the file's name and its bytes in base64 (`lib/vault-files.js`). The bytes go to `bw` on stdin. botdot lists it by its name and size and never answers its content.
- What botdot accepts is data: an extension and a check of the content. `.pem` (a `-----BEGIN` line) is the only type in this version. At most 64 KB a file.
- A bot the file is shared with runs one command with it, `run_with_file`. botdot writes the file as the bot user into a new folder in `/tmp` (0700, the file 0600) with its bytes on stdin, runs the command with the path in `BOTDOT_FILE`, and removes the folder when the command ends, fails or runs out of time. Folders a stopped botdot left are removed at the next use. What the command prints has the file blanked out.
- Sharing a file with a bot is the owner's consent to that use: a file has no other use, so it has no "Usable in its computer" switch of its own. The bots' list in the Vault and the add dialog say that every bot on the computer could read it while the command runs.

## Alternatives

- Option B, no file the bot can read: a helper that signs or loads the key as root, as `run_with_ssh_key` does with its agent. Stronger, but one helper per use, and a `.pem` that signs a JWT fits only if botdot does the signing itself. The owner chose A.
- A Bitwarden attachment (`bw create attachment`): needs Bitwarden Premium, and `bw` reads it from a file on the botdot server's disk.
- botdot's own vault: every new kind since SSH keys is Bitwarden's, and its move into Bitwarden would need to carry files too.
- A "Usable in its computer" switch for files: it would only ask the same question twice.

## Consequences

- A secret is in a file of the computer while a command runs. Every bot there can read it through sudo, as it can a login in `run_with_login` (ADR 035); the file's mode keeps out only programs that run as another user. SECURITY.md says so.
- Adding a type later is a line in `lib/vault-files.js`, the apps' file picker and the docs.
- A Bitwarden field holds at most 5000 encrypted characters, so a file is split over up to about 30 hidden fields; changing them in Bitwarden breaks the file.
