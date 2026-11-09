<script>
  const GITHUB = 'https://github.com/Kordal/bot-dot';
  const DOCS = `${GITHUB}/blob/main`;
  const DOWNLOAD = `${GITHUB}/releases/download/desktop-latest`;
  const INSTALL = ['git clone https://github.com/Kordal/bot-dot.git bot-dot-source', 'sudo sh bot-dot-source/install.sh'];

  // The features with a screen of the real app, words beside the picture, each other row mirrored.
  const shown = [
    {
      title: "Ask, don't configure",
      text: 'Say what you need in one chat. It makes the bots, changes them, runs them and reports back.',
      ask: 'Make a bot that sends me the three biggest tech stories every morning at 8.',
      img: 'web-chief',
      alt: 'The chat that runs the team: it made Recipe Finder, then set up a tile and a job, which wait for an OK as cards in the chat',
    },
    {
      title: 'Your OK first',
      text: 'A script, a login, a write in a connected app or anything risky waits in Needs you, with exactly what it would run.',
      img: 'web-needs-you',
      alt: 'Needs you: a job named Night mode and a Router uptime tile, each with the script it would run and its buttons',
    },
    {
      title: 'Projects',
      text: 'A space for one goal, such as a renovation or a launch: a team of bots with a lead, one team chat, goals you can count and a calendar of to-dos.',
      img: 'web-project',
      alt: 'The project Kitchen renovation: its team of three bots, two goals, a calendar of dated to-dos, and the team chat where the lead hands work on',
    },
    {
      title: 'The Board',
      text: 'Live tiles for what you check every day: switches, values, lists and notes. Built by chat.',
      ask: 'Add a switch for the living room light.',
      img: 'web-board',
      alt: 'The Board: value tiles with a line of recent values, a note written by a bot, two switches and a button, and a list',
    },
    {
      title: 'Pages',
      text: 'Reports bots keep up to date on a schedule, with live numbers and charts. Export to Word, PDF, Markdown or Google Docs.',
      img: 'web-page',
      height: 2557,
      alt: 'A page by Server Watch: uptime, disk, backups and updates as numbers, a chart of CPU over the week and disk use by folder',
    },
  ];

  const more = [
    ['Scheduled jobs', 'Work on a schedule. When no AI is needed, a small script runs instead.'],
    ['Groups', 'Two to six bots in one chat, handing the work on to each other until it is done.'],
    ['Memory', 'Bots remember what you tell them. Correct or erase it by chat.'],
    ['The computer', 'An always-on desktop where each bot has its own screen and browser. Watch live or take over.'],
    ['Logins and apps', 'Bots use your logins without seeing them, and Gmail, Slack, GitHub and more through Composio.'],
    ['Skills', 'Know-how a bot loads when it fits the task. Type / to run one yourself.'],
  ];

  const phones = [
    ['phone-list', "Home on a phone: what needs you, the Board's values and the bots with their status"],
    ['phone-chat', "News Monitor's chat on a phone"],
    ['phone-board', 'The Board on a phone'],
    ['phone-needs-you', 'Needs you on a phone, with two cards waiting for an OK'],
  ];

  const needs = [
    ['Server', 'A Linux VM or VPS with sudo: Ubuntu, Debian, Fedora or RHEL'],
    ['Size', '4 CPUs, 8 GB RAM, 40 GB disk'],
    ['Claude', 'Pro, Max or an API key'],
    ['Access', 'A domain, or Tailscale to keep it off the internet'],
  ];

  // The same files as docs/desktop.md (tests/site.test.js checks it).
  const desktop = [
    ['Windows', [['x64', 'botdot-windows-x64-setup.exe'], ['ARM', 'botdot-windows-arm64-setup.exe']]],
    ['Mac', [['Apple silicon', 'botdot-mac-apple-silicon.dmg'], ['Intel', 'botdot-mac-intel.dmg']]],
    ['Linux', [['AppImage', 'botdot-linux-x64.AppImage'], ['.deb', 'botdot-linux-x64.deb'], ['.rpm', 'botdot-linux-x64.rpm']]],
  ];

  const yours = [
    ['Your server', 'Each account is walled off: its own Linux user, rootless Docker and gVisor.'],
    ['Your Claude', 'The official Claude Code CLI, signed in with your own subscription or API key.'],
    ['No telemetry', 'botdot sends nothing to its author.', ['What leaves your server', `${DOCS}/docs/FAQ.md#does-botdot-send-anything-off-my-server`]],
    ['Open source', 'MIT licensed. Read the code, run it, change it.'],
  ];

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'botdot',
    url: 'https://botdot.app/',
    description: 'A self-hosted team of Claude Code bots you run by chat.',
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Linux server; apps for the web, Android, Windows, macOS and Linux',
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: GITHUB,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
</script>

<svelte:head>
  <title>botdot: a team of Claude Code bots you run by chat</title>
  <meta name="description" content="A self-hosted team of Claude Code bots you run by chat, on your own server. Web, Android and desktop apps. Open source, MIT.">
  <link rel="canonical" href="https://botdot.app/">
  <meta property="og:url" content="https://botdot.app/">
  <meta property="og:title" content="botdot">
  <meta property="og:description" content="A team of Claude Code bots you run by chat, on your own server.">
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
  <script src="/site.js" defer></script>
</svelte:head>

<main id="main">
  <div class="wide hero" id="top">
    <h1><span class="brand" aria-hidden="true">bot<i></i></span><span class="sr">botdot</span></h1>
    <p class="lead">A team of Claude Code bots you run by chat, on your own server.</p>
    <div class="actions">
      <a class="btn primary" href="#install">Install</a>
      <a class="btn" href={GITHUB}>GitHub</a>
    </div>
  </div>

  <div class="wide">
    <figure class="shot hero-shot"><img src="/img/web-home.webp" width="1800" height="1125" fetchpriority="high" alt="botdot in a wide window: two things waiting for an OK, the Board's live values, the bots as tiles with their status, and News Monitor's chat with the morning headlines"></figure>
  </div>

  <section class="wide" id="how" aria-labelledby="how-h">
    <h2 id="how-h">How it works</h2>
    <ol class="steps">
      <li><span class="n">01</span>Install it on a Linux server, or on your computer with the desktop app.</li>
      <li><span class="n">02</span>Sign in to Claude with your subscription or an API key.</li>
      <li><span class="n">03</span>Ask for your first bot.</li>
    </ol>
  </section>

  <section class="wide" id="features" aria-labelledby="features-h">
    <h2 id="features-h">What it does</h2>
    {#each shown as f}
      <article class="feature">
        <div class="text">
          <h3>{f.title}</h3>
          <p>{f.text}</p>
          {#if f.ask}<p class="ask">{f.ask}</p>{/if}
        </div>
        <figure class="shot" class:crop={f.height}><img src={`/img/${f.img}.webp`} width="1800" height={f.height || 1125} loading="lazy" alt={f.alt}></figure>
      </article>
    {/each}
    <ul class="grid">
      {#each more as [title, text]}<li><h3>{title}</h3><p>{text}</p></li>{/each}
    </ul>
  </section>

  <section class="wide" id="phone" aria-labelledby="phone-h">
    <h2 id="phone-h">On your phone</h2>
    <p class="muted measure">The Android app has notifications with Reply and Approve, with no push service, and shares files to a bot from any app. On an iPhone, add the web page to the Home Screen.</p>
    <div class="phones">
      {#each phones as [img, alt]}<figure class="shot"><img src={`/img/${img}.webp`} width="720" height="1558" loading="lazy" {alt}></figure>{/each}
    </div>
  </section>

  <section class="wide" id="install" aria-labelledby="install-h">
    <h2 id="install-h">Install</h2>
    <div class="get">
      <div class="card server">
        <div class="row">
          <h3>On a server</h3>
          <button class="copy" type="button" id="copy" aria-label="Copy the install commands">Copy</button>
        </div>
        <pre id="cmd"><code>{#each INSTALL as line, i}{#if i}{'\n'}{/if}<span class="p" aria-hidden="true">$ </span>{line}{/each}</code></pre>
        <table class="needs">
          <caption class="sr">What you need</caption>
          <tbody>
            {#each needs as [what, value]}<tr><th scope="row">{what}</th><td>{value}</td></tr>{/each}
          </tbody>
        </table>
        <a class="more" href={`${DOCS}/docs/install-linux.md`}>Install guide</a>
      </div>

      <div class="card">
        <h3>Desktop</h3>
        <dl class="dl">
          {#each desktop as [os, files]}
            <dt>{os}</dt>
            <dd>{#each files as [label, file]}<a href={`${DOWNLOAD}/${file}`}>{label}</a>{/each}</dd>
          {/each}
        </dl>
        <p class="muted">Opens your botdot in a window, or runs botdot on the computer itself, with no server (preview).</p>
        <a class="more" href={`${DOCS}/docs/desktop.md`}>The desktop app</a>
      </div>

      <div class="card">
        <h3>Phone</h3>
        <dl class="dl">
          <dt>Android</dt>
          <dd><a href={`${GITHUB}/releases?q=android-v&expanded=true`}>.apk</a></dd>
          <dt>iPhone</dt>
          <dd><span>Web page</span></dd>
        </dl>
        <p class="muted">Install the app once. After that it updates itself from your server.</p>
        <a class="more" href={`${DOCS}/android/README.md`}>The Android app</a>
      </div>
    </div>
  </section>

  <section class="wide" id="yours" aria-labelledby="yours-h">
    <h2 id="yours-h">Yours</h2>
    <ul class="grid">
      {#each yours as [title, text, link]}<li><h3>{title}</h3><p>{text}{#if link}{' '}<a href={link[1]}>{link[0]}</a>{/if}</p></li>{/each}
    </ul>
  </section>

  <section class="col" id="ai" aria-labelledby="ai-h">
    <h2 id="ai-h">Built with AI</h2>
    <div class="prose">
      <p>botdot is built with AI. All of it: code, docs, design.</p>
      <p>I'm not hiding it, and I'm not apologizing for it. AI is a tool. I use it like a <code>compiler</code> or an <code>editor</code>, to ship software that works.</p>
      <p>I won't debate whether that's right or wrong. That conversation doesn't happen here. If it bothers you, don't use it. No hard feelings. If it doesn't, everything is open source. Read the code and judge the result.</p>
    </div>
  </section>
</main>
