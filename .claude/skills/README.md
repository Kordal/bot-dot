# Agent skills

The skills `AGENTS.md` routes work through, copied unchanged so that cloud sessions, which have none of the owner's local skills, find them in the repository.

- Source: [mattpocock/skills](https://github.com/mattpocock/skills), listed at <https://www.aihero.dev/skills>
- Commit: `49dd158d1076134a641b33efb035946536778336` (9 October 2026)
- License: MIT, Copyright (c) 2026 Matt Pocock, kept in [LICENSE](LICENSE)

| Skill | Upstream path | Why it is here |
| --- | --- | --- |
| `ask-matt` | `skills/engineering/ask-matt` | Named in `AGENTS.md` |
| `code-review` | `skills/engineering/code-review` | Named in `AGENTS.md` |
| `diagnosing-bugs` | `skills/engineering/diagnosing-bugs` | Named in `AGENTS.md` |
| `grill-with-docs` | `skills/engineering/grill-with-docs` | Named in `AGENTS.md` |
| `implement` | `skills/engineering/implement` | Named in `AGENTS.md` |
| `improve-codebase-architecture` | `skills/engineering/improve-codebase-architecture` | Named in `AGENTS.md` |
| `tdd` | `skills/engineering/tdd` | Named in `AGENTS.md` |
| `to-spec` | `skills/engineering/to-spec` | Named in `AGENTS.md` |
| `to-tickets` | `skills/engineering/to-tickets` | Named in `AGENTS.md` |
| `triage` | `skills/engineering/triage` | Named in `AGENTS.md` |
| `wayfinder` | `skills/engineering/wayfinder` | Named in `AGENTS.md` |
| `codebase-design` | `skills/engineering/codebase-design` | Called by `improve-codebase-architecture` and `tdd` |
| `domain-modeling` | `skills/engineering/domain-modeling` | Called by `grill-with-docs`, `improve-codebase-architecture`, `triage` and `wayfinder` |
| `grilling` | `skills/productivity/grilling` | Called by `grill-with-docs`, `improve-codebase-architecture`, `triage` and `wayfinder` |
| `prototype` | `skills/engineering/prototype` | Called by `wayfinder` |
| `research` | `skills/engineering/research` | Called by `wayfinder` |

To update, copy the same folders from a newer commit of the source, unchanged, and change the commit above. Local changes belong in `AGENTS.md` or `docs/agents/`, not in these files.
