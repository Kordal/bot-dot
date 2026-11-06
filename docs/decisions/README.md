# Decisions

Small, non-obvious choices that are not architecture: why a library, a default, a workaround or a rejected approach was picked. An architecture decision is an [ADR](../adr/README.md) instead.

One decision per file, written in the change that made the choice:

- Name: `YYYY-MM-DD-short-name.md`, the date it was made and a few words of the choice (`2026-11-05-a-backup-leaves-out-node-modules.md`).
- Text: one line, `YYYY-MM-DD: <choice>, because <reason>. Rejected: <alternative> (<why>). (<PR, task or plan>)`.

A file of its own means two changes never edit the same lines, so decisions never cause a merge conflict. To change a decision, add a new file that says what it replaces; leave the old one as it was.

Find one with `ls docs/decisions` (the names are in date order) or `grep -ril <word> docs/decisions`.
