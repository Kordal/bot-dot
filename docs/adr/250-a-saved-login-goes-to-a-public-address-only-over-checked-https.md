# ADR-250: A saved login goes to a public address only over checked https

- **Status:** Accepted (2026-11-15, the owner approved the security review's must-fix list, M4)
- **Owning task:** security review 2026-11, finding M4
- **Amends:** [ADR 177](177-every-saved-login-accepts-a-self-signed-certificate-and-is-usable-in-its-computer.md), its certificate half: the self-signed exception stays for internal hosts only

## Context

`api_request` and Board tiles send a saved login's secret in a header (`lib/vault-http.js`). Since ADR 177 every such request accepted any certificate, so the exception meant for the owner's Proxmox or NAS also covered api.github.com, Stripe and every public API: anyone on the network path, or with a false DNS answer, could take the bearer token. A bot could also write `http://` and send the token in clear text, or name another port of the same host, which on a managed machine also passes the container's egress rules, as the server makes the request.

## Decision

- **A public address takes a saved login over https only, on port 443, with its certificate checked.** "Public" is what `internalHost` (`lib/network-address.js`) does not call internal: an IP of a private range (the LAN, the tailnet), or a name without a dot or under `.local`, `.localhost`, `.lan`, `.internal` or `.home.arpa`.
- **An internal host keeps ADR 177:** http or https, any port, a self-signed certificate accepted. An internal-looking name counts as internal only while every address it resolves to is private: one that resolves to a public machine gets the public rule.
- **What a bot is told:** `http://` to a public host and another port are refused before anything is sent; a certificate that does not verify ends the request with that reason and "nothing was sent" (the TLS handshake fails before the headers go).
- `run_with_login` is unchanged: the command in the bot's computer gets the values, as ADR 177 says.

## Alternatives

- **Store the scheme and port with each login and require both to match**, as the review proposed: a login keeps only its host today (`normalizeSite`, the Bitwarden item's first URI), so this needs a change of what is stored and of the editor. A later change can add it; until then a public service on another port is not usable with a saved login.
- **A per-login switch for a public host with a self-signed certificate:** the switch ADR 177 removed; such a server can be saved by its internal name or address instead.

## Consequences

- A login for a public service whose certificate is self-signed, or that listens on another port, stops working with `api_request` and Board tiles until it is saved by an internal name or address.
- `insecureTls` in `GET /api/vault` stays `true` for older apps; it no longer describes a public host.
