# ADR-048: The admin page shows the Feedback an owner sends the admin

- **Status:** Accepted (by the owner, 2026-10-21)
- **Owning task:** [#216](https://github.com/Kordal/bot-dot/issues/216)
- **Changes:** [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md), the line "The admin page never shows what is inside an account"

## Context

An owner has no way to tell the admin of their machine about a bug or a missing feature. A botdot server has no route to the admin, and the admin page shows nothing from inside an account ([ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)). The front door is the one program that knows both the signed-in account and the admin page.

The owner decided (2026-10-21) that a report goes to a list on the admin page of that machine, not to GitHub issues and not to a GitHub form.

## Decision

- A **Feedback** icon sits beside Settings, on the web page and in the Android app. It opens a form: Bug or Feature request, and a text. The form says that the admin of this machine reads it.
- The report goes to the front door, `POST /front-door/feedback`, which answers it itself: it never reaches the account's botdot server, so no Chief or bot sends, reads or changes one. The front door keeps it in its own data with the account, the time, the kind, the app the session signed in with and the version root's step last said. Nothing else of the account goes with it: no chat, bot or note.
- The admin page lists the reports, newest first, with that account's name, and the admin marks one done (it stays) or deletes it. Only the admin's session reads the list; every other session gets `404`, as for the rest of `/admin`. The text is drawn as text, never as markup (AGENTS.md rule 6).
- So the admin page now shows one thing from inside an account: what an owner wrote to the admin, on purpose. It still shows nothing an owner did not send.
- A machine of one account (the Mac app's) has no admin page, so it shows no Feedback: `GET /front-door/session` says `feedback: false` there, and the icon stays hidden.
- Limits: at most 2000 characters a report, 10 reports an account an hour, and the newest 1000 kept.

## Alternatives

- **GitHub issues or a GitHub form.** Rejected by the owner: a report would leave the machine, and the owner's admin, not botdot's developers, is who runs it.
- **Through the Chief.** Rejected: the Chief is what may be broken, and a report must not be readable by any bot.
- **A count of new reports on the Admin icon, or a notification.** Left for later.

## Consequences

- The front door's data holds the owners' reports besides accounts, passkeys, sessions and links.
- A new control beside Settings goes against AGENTS.md rule 5 ("no new control for something the Chief can do by chat") on purpose (`docs/DECISIONS.md`, 2026-10-21).
- An app older than this front door shows no Feedback; a front door older than the app leaves `feedback` out, and the app shows none.

## Amendment: screenshots (2026-10-21, [#223](https://github.com/Kordal/bot-dot/issues/223))

Accepted by the owner, 2026-10-21. A bug is often easier to show than to describe, so a report may now hold screenshots the owner added on purpose. This changes "Nothing else of the account goes with it" above: a screenshot can show anything on the owner's screen (other chats, other tabs), and the form says plainly that the admin sees each one whole.

- The form has "Add screenshot", which opens the device's picker. At most 3 a report, each at most 5 MB, as PNG, JPEG or WebP. No SVG (it can carry script) and no GIF. The text stays required. Paste and drag are not in v1.
- They go in the same `POST /front-door/feedback` as the text, as base64, so a report is never kept half: that route alone reads up to about 20 MB; every other front-door route keeps 64 KB.
- The front door reads each picture's type from its first bytes, never from the name or what the app says, and refuses anything else with `400` in plain words.
- Each picture is its own file in `feedback-screenshots/` beside `front-door.json` (mode 600, folder 700, the front door's user), named by the report and its number. The report keeps only each picture's type and size: `front-door.json` is read whole and rewritten on every change, and holds up to 1000 reports.
- The machine keeps up to 500 MB of screenshots. Past that the oldest reports' pictures are deleted first; those reports keep their text and say their screenshots went. Deleting a report, or the admin deleting an account, deletes its pictures.
- The admin page shows them as thumbnails, `img` elements its script makes, which open `GET /admin/feedback/<id>/screenshot/<n>`: the admin's session alone, with the type the front door read, `nosniff`, `inline` and a `sandbox` CSP, so a file is never drawn as a page.
- `GET /front-door/session` says `feedbackScreenshots`: an app shows "Add screenshot" only for a front door that takes them, and an older app, which sends `{ kind, text }`, works as before.
- The Android app scales a photo over 5 MB down (longest side 2560, JPEG) before sending, so a large photo still goes.
