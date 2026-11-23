Commands on the External Virtual PC use your proxy
- When you have a proxy, a bot's commands on the External Virtual PC (curl, git, pip, npm) now go through it too, not only its browser.
- A changed or removed proxy applies from the bot's next command.
- If the proxy can't be reached, the command does not run and the bot tells you to test the proxy in Settings → Proxy.
