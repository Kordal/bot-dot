A bot can keep a saved secret in a file
- When a program needs a secret in a config or env file (Traefik, a systemd unit), the bot asks you on a card, and botdot writes the file. The bot never sees the secret.
- The card says who can read the file: every bot on the account's computer, or anyone on that server.
- The Vault shows where each secret is kept, with "Remove the file".
