# Product Vision

## Core idea

botdot gives each person a team of AI bots they run by chat: a Chief of Staff creates, changes and runs the bots, and the web page and the Android and Mac apps are windows onto that person's account. One self-hosted machine holds one or more accounts, walled off from each other; its admin hands out sign-up links ([ADR 028](../adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)).

Today, getting an AI agent to do recurring work means configuring prompts, tools, permissions and schedules by hand, and then watching logs. botdot turns that into a messenger: each bot is a contact, giving it work is sending a message, and anything that needs the owner shows up as one thing to approve.

Bots that need a desktop work on the account's one computer, which stays on, as Grok Bot's do: each on a screen of its own with its own browser, all as one user with sudo, so they can install anything and share their files, and each can see what the others do and the secrets used there ([ADR 035](../adr/035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)).

## Principles

- **Chat first.** Anything the Chief of Staff can do by chat stays out of the UI. The UI has as few words, icons and controls as possible.
- **A glance tells the state.** Each bot's mark shows by its look and movement whether it is idle, working, waiting, failed, paused or needs the owner; counts are shown as marks, not digits.
- **The owner approves what matters.** Jobs, permissions, logins, payments and shared-memory changes wait for the owner's OK; bots get only the tools they need.
- **One server, native windows.** The web page, the Android app and the Mac app are separate native apps on one API ([ADR 0001](../adr/0001-native-apps-per-platform.md)) and get every feature together.
- **No costs, no caps.** No account ever shows what a run cost, and bots have no spending limits. The admin page alone shows each account's share of the machine.

## First milestone

The first milestone replaces each bot's dot with a head wearing a hat that Claude picks when the bot is created, with a face that shows its state: [milestone1.md](milestone1.md).

## Future direction

The architecture should later allow the product's name and logo to move away from "dot" without touching how bots are drawn, and more kinds of marks than one. None of that is designed yet.
