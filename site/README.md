# botdot.app

The project's homepage ([ADR 172](../docs/adr/172-botdot-app-is-a-prerendered-sveltekit-site-on-github-pages.md)): SvelteKit, prerendered to plain HTML with no framework code in the browser, published on GitHub Pages by [site-publish.yml](../.github/workflows/site-publish.yml).

```bash
cd site
npm ci
npm run dev       # → http://localhost:5173, reloads on save
npm test          # builds to build/ and checks it (tests/site.test.js)
npm run preview   # serves build/ as it is published
```

| Path | Contents |
| --- | --- |
| `src/routes/+page.svelte` | The homepage: its words, the features and the downloads are data at the top |
| `src/routes/changelog/` | The changelog page, from the notes of [whats-new/](../whats-new/) |
| `src/routes/changelog.md/` | The same notes as Markdown, for agents |
| `src/lib/changelog.js` | Reads the notes with the server's own reader, [lib/whats-new.js](../lib/whats-new.js) |
| `src/app.css` | The one stylesheet, in the app's colours |
| `static/` | Served as it is: the screens (`img/`), the font, `llms.txt`, `site.js` (the Copy button), icons, `og.png` |

The screens in `static/img/` are the real app drawn over staged demo data, 1800 px wide for the web page and 720 px for the phone, as WebP. The install commands must stay the README's and the desktop downloads `docs/desktop.md`'s: the tests check both.
