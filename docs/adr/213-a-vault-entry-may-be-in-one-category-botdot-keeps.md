# ADR-213: A Vault entry may be in one category botdot keeps

- **Status:** Accepted (2026-11-11, the owner: "add categories in the password vault, so the user can group his passwords")
- **Builds on:** [ADR 177](177-every-saved-login-accepts-a-self-signed-certificate-and-is-usable-in-its-computer.md)

## Context

Passwords is one list. With dozens of entries (shops, banks, servers, API tokens) the search finds one entry, but nothing shows which belong together, and the owner cannot fold away what they rarely open.

## Decision

- **An entry has at most one category:** the owner's word for a group, one line of at most 40 characters, on any kind (a login, a token, a card, an identity, an SSH key, a file). None is the default.
- **botdot keeps it, beside the entry's bots:** on the entry in the built-in vault, and in `data/bitwarden-access.json` with Bitwarden, as a login's type and additional hosts are. A change of it never edits the Bitwarden item.
- **One spelling per group:** a category typed as one in use but for its case is saved as that one.
- **It limits nothing.** Who may use an entry stays its bots. A bot's `list_logins` and the Chief's `list_vault` show it, so a bot can tell the owner's "my shopping logins" apart.
- **The Chief sets it** with `update_vault_item`, for any entry, at once and on no card, also after the web: a category is undone by another call and touches nothing a bot may use. A key's bots and name stay the only other things it changes.
- **The list is grouped:** entries without a category first, with no heading; then one heading per category, alphabetical, which the owner folds. A search matches category names and shows what matches in a folded group.

## Alternatives

- **Bitwarden folders under bot-dot** (`bot-dot/Shopping`). Rejected: every sync would list each subfolder with a bw command of seconds, an entry moved there leaves the folder botdot reads for an older app, and a card, a file and the built-in vault would need a second way anyway.
- **Several tags per entry.** Rejected: the owner asked to group; one group per entry gives a list with one place for each entry, and a search covers the rest.
- **Categories as a list of their own, made before use.** Rejected: an empty category has nothing to show, and a screen to manage them is more than the owner asked for. A category exists while an entry is in it.

## Consequences

- A category is not in Bitwarden: the owner sees it only in botdot, and an entry moved out of the bot-dot folder and back keeps it while its id stays.
- An app from before draws one list and keeps an entry's category on its saves, as it sends none.
