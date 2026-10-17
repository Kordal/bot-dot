# ADR-030: The Mac app is checked on GitHub's machines

- **Status:** Accepted (2026-10-17, the owner's decision)
- **Owning task:** [#528](https://github.com/Kordal/bot-dot/issues/528)

## Context

[ADR 022](022-the-mac-app-is-developed-again.md) left the Mac app without GitHub checks, because GitHub's Mac runners cost ten times the Linux ones on a private repository; a change that broke the Mac app was caught on a developer's Mac or not at all. The repository is going public, and a public repository gets GitHub's machines free, Macs included. Every workflow moves to them (#528).

## Decision

The Tests workflow has a `mac` job that runs `make mac-build` and `make mac-test` on GitHub's `macos-26` machine when a pull request changes `macos/` or the workflow itself, and on a run by hand. The workflows that publish skip it, since no image carries the Mac app. This supersedes ADR 022's "no GitHub checks"; the rest of ADR 022 stands: the Mac app is not released, signed for others or carried by an image.

## Alternatives

- **`macos-15`, as #528 first named.** Refused: the app and BotDotKit need macOS 26 (`platforms: [.macOS(.v26)]`), so their tests cannot run there.
- **Run the Mac checks on every pull request.** Refused by the owner: a Mac job takes far longer than the rest, and a server change that matters to the Mac app (what the server sends the apps) is checked on a Mac by AGENTS.md's rule.
- **Keep the Mac checks local.** Refused: with the machines free, a check nobody has to remember is better.

## Consequences

- A pull request that changes `macos/` shows a Mac check; a change only to the server does not, and is still checked on a Mac by hand when it changes what the apps are sent.
- Publishing the Mac app and signing it for others remain a later decision, with an ADR of their own.
