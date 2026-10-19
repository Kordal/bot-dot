# ADR-034: A bot's computer reaches the local network and its own loopback

- **Status:** Accepted (2026-10-19, the owner's decision). Supersedes the computer's firewall in [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) (the computer reached the internet only, and on its own loopback only botdot's ports).
- **Owning task:** the owner's request of 19 October 2026 ("Remove those option in the app in general. always allow local and internet for all bots")

## Context

A bot ran Proton Mail Bridge on its computer. Bridge listened on `127.0.0.1:1143`, and the bot's mail program could not reach it: the computer's firewall rejected all of `127.0.0.0/8` except botdot's own ports (8000, 6080, 5901, 6001, 47111), as part of the same private-address list that kept the computer off the owner's LAN. The same rule kept Tailscale's proxy on `localhost:1055` (ADR 032) from working on a computer set to "Internet only". Each bot had a "Computer network" setting, "Internet only" by default, and "Internet and local network" opened the private addresses, the loopback included, after the owner's OK on a card.

## Decision

- Every bot's computer reaches the internet, the local network and its own loopback. The "Computer network" setting is gone from the web page, the Android app, the API (`computerEgress`) and the Chief's tools; a bot stored with it is read without it.
- The firewall still keeps botdot's own ports (computer control, screen and the Camoufox bridge) from answering anybody outside the computer: under gVisor nothing leaves those ports on any interface but loopback, and under runc nothing comes in but on loopback or as an answer.
- A computer asks the machine's Tailscale resolver first whenever the machine runs Tailscale, as only a computer with local network access did before.
- A computer started by an older botdot gets the new firewall the next time it starts or a run uses it.

## Alternatives

- Open only the computer's own loopback and keep the setting for the LAN: rejected by the owner, who wants every bot on the local network without a setting.
- Give each service a port among botdot's: rejected, a program picks its own port, and botdot's ports are botdot's.

## Consequences

- A bot's programs reach each other on `127.0.0.1`: a mail bridge, a local database, Tailscale's proxy.
- Every bot's computer reaches the owner's router, NAS and other private services, and the machine botdot runs on. A bot given a computer gets this with it; the card for a computer says "a computer of its own, on your home network".
- On a machine with several accounts, a bot's computer reaches the addresses the account's Docker reaches, as a computer with local network access did before.
