<script>
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();
  const GITHUB = 'https://github.com/Kordal/bot-dot';
  const DOCS = `${GITHUB}/blob/main`;
  const onChangelog = $derived(page.url.pathname === '/changelog');
</script>

<a class="skip" href="#main">Skip to content</a>
<div class="bar">
  <header class="wide">
    <a class="brand" href="/" aria-label="botdot, home">bot<i></i></a>
    <nav aria-label="Sections">
      <a href="/#features">Features</a>
      <a href="/#install">Install</a>
      <a class="opt" class:on={onChangelog} href="/changelog" aria-current={onChangelog ? 'page' : undefined}>Changelog</a>
      <a href={GITHUB}>GitHub</a>
    </nav>
  </header>
</div>

{@render children()}

<footer class="wide">
  <a class="brand" href="/" aria-label="botdot, home">bot<i></i></a>
  <nav aria-label="More">
    <a href={`${DOCS}/docs/user-guide.md`}>User guide</a>
    <a href={`${DOCS}/docs/FAQ.md`}>FAQ</a>
    <a href="/changelog">Changelog</a>
    <a href={`${GITHUB}/releases`}>Releases</a>
    <a href="/llms.txt">llms.txt</a>
    <a href={`${DOCS}/LICENSE`}>MIT</a>
  </nav>
</footer>
