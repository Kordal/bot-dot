<script>
  let { data } = $props();
</script>

<svelte:head>
  <title>Changelog · botdot</title>
  <meta name="description" content="What changed in botdot, day by day.">
  <link rel="canonical" href="https://botdot.app/changelog">
  <meta property="og:url" content="https://botdot.app/changelog">
  <meta property="og:title" content="botdot changelog">
  <meta property="og:description" content="What changed in botdot, day by day.">
</svelte:head>

<main id="main" class="col changelog">
  <h1>Changelog</h1>
  {#each data.days as day}
    <section class="day" id={`d${day.date}`} aria-labelledby={`h${day.date}`}>
      <h2 id={`h${day.date}`}><time datetime={day.date}>{day.label}</time></h2>
      {#each day.notes as note}
        <article><h3>{note.title}</h3><ul>{#each note.points as point}<li>{point}</li>{/each}</ul></article>
      {/each}
    </section>
  {/each}
</main>
