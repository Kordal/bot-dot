# ADR-165: A phone sends files to the owner's place on a ten-minute code

- **Status:** Accepted (by the owner, 2026-11-06). Adds a second request the front door passes on without a session, beside a job's call ([ADR 026](026-a-call-is-let-in-on-the-jobs-key-alone.md), [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)).
- **Owning task:** Upload from phone (asked by the owner in the project thread, 2026-11-06)

## Context

The owner works at the computer, and the photo, scan or PDF they want to give a bot is on their phone. Signing in on the phone (a passkey, a session) to attach one file is a long way round, and on a machine of one account on a Mac (the desktop app's local server) the phone may not reach botdot at all. The front door lets nothing in without a session but a job's call.

## Decision

- **A code for one place.** On a wide screen the paperclip offers Files and From phone, and Files offers From phone beside Upload. From phone asks the botdot server for a code (`POST /api/drops`) naming the upload address the owner's page uses for that place: a chat's message box (`/api/uploads?to=…`) or the folder shown in Files (`…/workspace/upload?…`). Nothing else is a place.
- **The code.** 24 random bytes (32 characters), in the botdot server's memory only: good for ten minutes and 20 files, ended by the owner's ×, by New code, or by a restart. At most 20 live at once.
- **Through the front door without a session.** The QR code is the front door's own address (as it last named it to the botdot server) with the account and the code: `/drop/<account>/<code>`. The front door passes it on as `/api/drop/<code>[/files]`, marked `X-Botdot-Drop: 1`, with only the headers an upload needs, and strips that mark from every other request. A code never made, and an account that doesn't exist, answer `404` the same and count against the client as wrong call keys do.
- **The marked request reaches the code's page and upload alone.** The page is botdot's own: one HTML file with its style and script under a nonce, no session, no file of the web page. A file is taken by the code's upload address, run as the owner's own request: the same checks, limits (25 MB), names and audit as an upload from the owner's page. The owner's page lists what arrived (`GET /api/drops/<code>`) and puts each file saved in the message box, ready to send, or shows the folder again.
- **The QR code is drawn by botdot.** The server makes it as an SVG from the address with a copy of qrcode-generator in `vendor/` (MIT, no dependency), and hands it out, so every app draws the same thing.
- **A phone that can't reach botdot.** When the front door's address is this machine alone (the loopback, a `.localhost` name), the card says "Your phone can't reach botdot yet." instead of a code.

## Alternatives

- **Sign in on the phone.** It works already, and stays the way for more than files. Rejected as the way for one file: a passkey and the app or a browser session for a moment's job.
- **A code with an account's session behind it.** The phone would get a session for ten minutes. Rejected: a session reaches everything of the account; a code reaches one upload.
- **The code signed (HMAC) instead of kept.** It would survive a restart. Rejected: it can't be ended by ×, can't count its files, and a restart in ten minutes is rare.
- **A QR code drawn by the web page.** Rejected: Android would need its own, and the server draws it once (AGENTS.md, decided once on the server).

## Consequences

- Anyone who sees the QR code within its ten minutes can send files to that one place, as the owner. The place is the owner's own chat box or folder, and a file there is the owner's to send or delete; nothing is sent to a bot until the owner sends the message.
- On a tailnet-only machine the phone must be on the tailnet; on a public one any phone reaches it.
- The Android app has no From phone: there the phone is the one in hand. It ignores `phone-upload`.
