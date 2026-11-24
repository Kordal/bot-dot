# ADR-259: Feedback goes to botdot's developers through a relay when the machine says yes

- **Status:** Accepted (by the owner, 2026-11-20)
- **Owning task:** [#1565](https://github.com/Kordal/bot-dot/issues/1565)
- **Amends:** [ADR 048](048-the-admin-page-shows-the-feedback-an-owner-sends-the-admin.md) (Feedback goes to the admin page, never to GitHub) and [ADR 164](164-a-managed-machines-feedback-goes-to-the-fleet-console-through-an-outbox.md) (a reply from the console was left for later)
- **Builds on:** [ADR 150](150-iphone-notifications-go-sealed-through-a-project-relay.md) (a small project relay), [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (the fleet console), [ADR 241](241-a-managed-machines-owner-asks-for-deletion-in-the-app.md) (deletion asked in the app)

## Context

Feedback is one way. An owner sends a report and never hears of it again: the admin can only mark it done or delete it, the fleet console cannot answer at all, and nothing tells the owner that what they reported was fixed. A machine of one account, most self-hosted installs, has no Feedback at all, as there is no admin to read it. So botdot's developers hear of a bug only when someone finds the GitHub repository.

The owner wants owners to reach the developers with no more effort than today's Send, and to be told when their report is fixed. An AI chat that writes GitHub issues through OpenRouter was weighed and dropped: a report form needs no model. A pre-filled GitHub issue link was dropped too: it needs a GitHub account and a second page, and loses the screenshots.

## Decision

**One switch: "Send Feedback to botdot's developers".**

- On a self-hosted machine the admin sets it for the whole machine: `install.sh` asks when someone is there to answer, and says no when nobody is (an unattended install never says yes for anyone); the admin page has the switch, with the line "Reports from every account on this machine go to botdot's developers instead of here."
- On a managed machine each owner is asked once in onboarding, yes or no, and changes it in Settings.
- **On:** every report goes to the developers and to no admin page. The form says so, and that its text may be published, without personal details. Sending is the owner's consent; no other account is asked.
- **Off:** as today. A machine of several accounts sends it to its admin page; a machine of one account, and a managed account that said no, show no Feedback.
- Turned off, nothing new is sent; reports already sent stay at the relay and keep their status.

**The Feedback relay.** A small service of the developers', in the private `botdot-hosting` repository beside the fleet console, but a process, container, user, data folder and hostname of its own on the same VPS: it takes requests from any install on the internet, and the console holds the keys to every managed machine. It has memory, CPU, request-size and disk limits of its own, and never reads the console's data; the console's operator page reads its reports. It can move to a VPS of its own with only its address changing.

- A self-hosted front door sends its reports to the relay. A managed machine keeps the outbox of ADR 164, so the console receives them as now.
- **What is sent:** kind, text, screenshots, app and version, and the machine's **install token**: a random token the relay issues when the switch is first turned on, kept when it is turned off. Nothing else: no account name, bot name or address. The front door keeps which account each report id belongs to.
- The relay limits reports per token and per day, caps their size, and can revoke a token.

**Review, then publish.** Nothing reaches the public repository without a person.

- The relay keeps the report privately and drafts a public one: the text with email addresses, phone numbers, IP and web addresses, keys and tokens removed, plus the kind, app and version. The front door also removes the account's own name and its bots' names before sending.
- In the console the operator sees the draft beside the original, writes the public title and body in English, and **publishes** it as an issue in `Kordal/bot-dot` with the label `from-feedback`, adds it to an existing issue, or closes it unpublished.
- **Screenshots are never published.** They stay with the private report.

**The owner hears back.**

- Each report has a status: *Sent*, *Seen*, *Fixed in <version>* (with the public issue's link when there is one), or *Won't fix* with one line from the operator. Closing a public issue as fixed in a version sets that on every report published or added to it.
- A self-hosted machine asks the relay for the status of its report ids with its update check, every 6 hours. A managed machine gets them from its agent as a file the front door reads, the outbox's way in reverse; it holds ids, statuses, versions, links and the one line, nothing else.
- Settings → Feedback lists **My reports** with their status. When the account runs the version a report was fixed in, the apps say so once, as they do What's new: "Fixed: your report from 3 Nov".

**Retention and erasure.**

- Screenshots are deleted 90 days after their report is closed. A report's private text is kept while its public issue exists, and a year if it was never published.
- An account deleted on a self-hosted machine has the machine ask the relay to delete its reports, text and screenshots; a managed account's deletion (ADR 241) does it in the console. A published issue stays: it holds no personal details.

## Alternatives

- **An AI chat on OpenRouter that writes and posts the issue.** It would ask the follow-up questions, but it needs a key no self-hosted machine may hold, and a form already says what a bug needs. Dropped by the owner.
- **A pre-filled GitHub issue link.** No server, and GitHub tells the owner of the fix, but it needs a GitHub account and a second page, and takes no screenshot. Rejected as too much effort for the owner.
- **Publishing each report at once, cleaned by rules.** No work for the developers, but rules cannot see a name in a sentence or anything in a screenshot, and a public, indexed leak of an owner's data is the cost. Rejected.
- **The relay inside the fleet console's process.** One service less, but code that takes requests from anyone would run beside the keys to the whole fleet. Rejected.
- **A copy on the admin page as well.** Rejected by the owner: with the switch on, Feedback goes to the developers only.
- **A second onboarding question, on publishing.** Rejected by the owner as too complicated; the form says that text may be published.

## Consequences

- "Botdot sends nothing to its author" (FAQ) becomes "nothing unless you turn on Feedback to the developers".
- An admin who turns the switch on no longer sees their owners' reports; supporting that machine's owners moves to the developers.
- The developers run and answer for one more public service, and review every report by hand before it is public.
- The front door's data gains each report's relay id and status, and the install token. `GET /front-door/session` and `docs/api.md` say whether the switch is on and where Feedback goes, so an older app still shows the form as before.
- `botdot-hosting` needs an ADR of its own for the relay, its review page and the statuses back through the agent.

## Notes

- 2026-11-24: the relay's default address is `https://relay.botdot.app`, chosen by the owner ([#1566](https://github.com/Kordal/bot-dot/issues/1566)); `https://feedback.botdot.app`, named in the first version of the protocol, was never in DNS and is not used. The protocol is as written: only the address changed. `FRONT_DOOR_FEEDBACK_RELAY` still overrides it.
