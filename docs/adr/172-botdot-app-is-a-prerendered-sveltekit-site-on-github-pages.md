# ADR-172: botdot.app is a prerendered SvelteKit site on GitHub Pages

- **Status:** Accepted (2026-11-09, the owner asked for the homepage on SvelteKit)
- **Owning task:** the owner's request for the botdot.app homepage
- **Builds on:** [ADR 137](137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md) (the desktop app, whose downloads the page links)

## Context

botdot.app, the apex domain, needs a homepage: what botdot is, how to install it on a server, the desktop apps and the Android app, the real app's screens, a changelog, and a plain text entry for agents (`llms.txt`). It must not depend on any account's botdot (hq.botdot.app is the owner's own install), must load nothing from a third party (botdot sends no telemetry, and the page should not either), and must stay fast on a phone. The owner asked for SvelteKit.

## Decision

- **SvelteKit in `site/`, with its own `package.json` and lock file.** The repository's root keeps no dependencies (the server and the web page stay plain Node, HTML, CSS and JavaScript); only `site/` installs anything, and only to build.
- **Every page is prerendered, with no framework code in the browser.** `adapter-static` writes plain HTML to `site/build/`; `csr = false` in the root layout, so a visitor downloads HTML, one CSS file, the Geist font (a Latin subset as WOFF2, from the site itself) and WebP screens. The one script is `static/site.js`, the Copy button of the install commands and the lit nav link.
- **The changelog is the notes of `whats-new/`,** read at build time with the server's own reader (`lib/whats-new.js`), as a page for people (`/changelog`) and as Markdown for agents (`/changelog.md`), so it never needs a hand edit. `llms.txt` links the repository's documents in Markdown.
- **The screens are the real app's,** staged demo data drawn by the app's own code, as WebP under `site/static/img/`.
- **Published on GitHub Pages by `.github/workflows/site-publish.yml`,** on a run by hand, or on each change to main once the repository variable `SITE_PAGES` is `true`. A pull request that touches the site runs `.github/workflows/site.yml`: the build and `site/tests/`, which check the links, the pictures, that nothing comes from another site, that the install commands are the README's and the downloads `docs/desktop.md`'s.

## Alternatives

- **Hand-written HTML with a small build script (zero dependencies):** the first draft of this page. Lighter, but every new page repeats the head, the bar and the footer by hand; SvelteKit gives components and prerendering for the pages to come, at the cost of build-time dependencies in one folder.
- **SvelteKit with client-side navigation:** about 30 KB of JavaScript and a hydration step for pages that change nothing once loaded.
- **Serving the site from a botdot server:** the apex domain would go down with that machine.
- **Google Fonts, as in the October mockup:** a third party would see every visitor.

## Consequences

- `site/` has npm dependencies (SvelteKit, Svelte, Vite, the static adapter), pinned exactly in `site/package-lock.json`; they run only at build time, never on a botdot server or in a visitor's browser.
- Publishing needs the owner once: Settings → Pages → Source "GitHub Actions", the custom domain `botdot.app` with its DNS records, and `SITE_PAGES` set to `true`.
- A change to `whats-new/` republishes the changelog.
