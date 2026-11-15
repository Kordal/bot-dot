# The overview has no Goal section

ADR 236 opened a project on a fixed overview that began with "an immediate account of its goal". The owner asked to remove the whole Goal (2026-11-15): on most projects it read "No goal set.", and the settings had already lost their Goal section (#1354). The overview now starts with what is happening, and its snapshot (`GET /api/company/overview`) leaves the goal out.

Older apps draw the goal from the project (`GET /api/company`, `goal`), not from the snapshot, so they show it as before; the snapshot's `goal` was read by no app. The goal stays in the project: the prompts read it, and the Chief changes it with `set_project_goal`.
