# ADR-234: A managed machine's Settings open the billing page the fleet console names

- **Status:** Accepted (2026-11-13, the owner: "User should have a link in settings to manage his sub")
- **Builds on:** [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (a managed machine, run by the fleet console), [#1312](https://github.com/Kordal/bot-dot/issues/1312) (a managed machine's "Delete account" opens a page of botdot.app)

## Context

A hosted account is a managed machine that the fleet console (botdot-hosting) runs. Billing for it is not built yet, and its provider is not chosen (Stripe with its customer portal, Stripe Managed Payments, or Paddle). The owner of a paying account still needs one place, in the app, to see and change what they pay for, and the app must not wait for the provider choice nor learn any provider's API.

## Decision

- **The console names the page; botdot only opens it.** `FRONT_DOOR_SUBSCRIPTION_URL` is given to the installer once, kept, and passed to the front door, like the terms' addresses (#987). Any provider's page works: a Stripe customer portal login link, a Paddle page, or the console's own page that makes a portal session and redirects.
- **`{account}` in it is the session's account,** URL-encoded, so a machine of several accounts can point each at its own page. The page itself still authenticates its visitor: the address is not a secret and gives no access.
- **Only on a managed machine and only an https address.** Elsewhere, unset or not https, the front door says nothing (with a line in its log for a wrong one) and its session's `subscriptionPage` is `null`.
- **Settings shows one row, "Subscription", with no other words,** only when the session names a page: on the web page a link in a new tab, which the desktop app hands to the default browser (`on_new_window`, #999, #1319); on Android the browser. An older front door leaves `subscriptionPage` out and the apps show nothing.

## Alternatives

- **A billing screen in botdot** (plan, invoices, cancel): it would tie every app to one provider and its taxes; the providers' own portals already do it.
- **The console's address fixed in botdot**, as `DELETE_ACCOUNT_PAGE` is: the provider and its page are not chosen, and a self-hosted fork would point at botdot's billing.
- **An API call to fetch a fresh portal session per click**: it needs the provider's secret on every machine; the console holds it instead and can redirect.

## Consequences

- Nothing shows until the console passes `FRONT_DOOR_SUBSCRIPTION_URL` to `install.sh` on the managed machine; changing it is a rerun with the new value.
- A self-hosted or local machine never shows the row.
