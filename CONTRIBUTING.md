# Contributing

Thank you for helping with botdot. This page is short on purpose: the details are in the documents it links.

## Run it

botdot's server needs nothing but Node 22.13 or newer, and no packages to install.

```bash
npm start            # → http://localhost:4747
```

[Development](docs/development.md#running-it) has the setup notes (the Claude CLI, the port, the data folder) and the code layout. To run a whole botdot machine, see [Install on Linux](docs/install-linux.md).

## Run the tests

```bash
npm test             # the server's and the web page's tests, with a stand-in for Claude
make lint            # the documentation links, that the code parses, and the type checks
```

Both need nothing running, and both must pass before a change is done. `make help` lists the slower suites (the Android app, a real install); run the ones that cover what you changed. [Development](docs/development.md#tests) says what the tests cover.

## Make a change

- **One change per pull request.** Fix one bug or add one thing; anything else you notice goes in a new issue.
- **Tests come with the change.** A new feature or a fixed bug gets a test that would fail without it.
- **Write the pull request as Before, After and How:** what was wrong or missing, what is true now, and how the change does it. Say what you did not check.
- **A change to the API** (what the server sends or accepts) is written in [docs/api.md](docs/api.md) in the same pull request.
- **A change to the architecture** needs an ADR in [docs/adr/](docs/adr/README.md).

[AGENTS.md](AGENTS.md) holds the full rules of this repository, for people and coding agents alike.

## How we write

Plain words and short sentences, in the docs, the code and what the app says. Use the product's own words from [CONTEXT.md](CONTEXT.md) (bot, Chief of Staff, Board), and see [AGENTS.md](AGENTS.md) for the rest.

## Security

Don't open a public issue for a security problem. [SECURITY.md](SECURITY.md) says how to report one privately.

## Conduct

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).
