<script>
  // The page's own code: data.json, drawn with the kit's classes (kit/botdot-kit.css), and a kpi kept live from a
  // Board tile. window.botdot comes from kit/botdot-kit.js, loaded before this.
  const botdot = window.botdot;
  const LEVEL = { Done: 'ok', 'In progress': 'info', Waiting: 'warn', Blocked: 'err', Planned: 'plan' };

  let data = $state({ items: [], kpis: [] });
  let view = $state('overview');
  let q = $state('');
  let live = $state({});
  let ring = $state();

  botdot.data().then((d) => { data = { items: [], kpis: [], ...d }; });
  // Live values: the tiles named in publish_interactive_page's `tiles`, by the name given there.
  botdot.onValues((values) => { live = values; });

  const items = $derived(data.items.filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase())));
  const valueOf = (k) => (k.tile && live[k.tile]?.data?.value !== undefined ? live[k.tile].data.value : k.value);

  $effect(() => { if (ring && data.done != null) botdot.ring(ring, data.done, 'done'); });
</script>

<div class="site">
  <nav class="nav">
    <span class="logo"><i></i>{data.name || 'Project'}</span>
    <button class="link" class:on={view === 'overview'} onclick={() => (view = 'overview')}>Overview</button>
    <button class="link" class:on={view === 'items'} onclick={() => (view = 'items')}>Items</button>
    <span class="spacer"></span>
  </nav>

  <header class="hero">
    <div class="text">
      {#if data.asOf}<div class="eyebrow">As of {data.asOf}</div>{/if}
      <h1>{data.title || ''}</h1>
      <p>{data.lead || ''}</p>
    </div>
    <div bind:this={ring}></div>
  </header>

  {#if view === 'overview'}
    <section class="section">
      <div class="grid c3">
        {#each data.kpis as k}
          <div class="card kpi">
            <div class="label">{k.label}</div>
            <div class="value">{valueOf(k)}{#if k.unit}<small>{k.unit}</small>{/if}</div>
            {#if k.tile && live[k.tile]}<div class="sub">live from the Board</div>{:else if k.sub}<div class="sub">{k.sub}</div>{/if}
            {@html botdot.spark(k.points)}
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <section class="section">
      <div class="bar-row" style="padding-left:0;padding-right:0">
        <input class="search" placeholder="Search" aria-label="Search" bind:value={q}>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>State</th><th>Changed</th></tr></thead>
          <tbody>
            {#each items as r}
              <tr><td>{r.name}</td><td><span class="pill {LEVEL[r.state] || ''}">{r.state}</span></td><td class="faint">{r.changed}</td></tr>
            {:else}
              <tr><td colspan="3" class="empty">Nothing matches.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>
