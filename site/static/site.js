// botdot.app: the Copy button of the install commands, and the nav link of the section on screen.
const copy = document.getElementById('copy');
if (copy) {
  copy.addEventListener('click', async () => {
    const text = document.querySelector('#cmd code').textContent.replace(/^\$ /gm, '');
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      // No clipboard (an old browser, a page not on HTTPS): select the commands so Ctrl+C copies them.
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#cmd code'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
  });
}

const links = [...document.querySelectorAll('header nav a[href^="#"]')];
const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
if (sections.length && 'IntersectionObserver' in window) {
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => seen.set(e.target, e.isIntersecting));
    const first = sections.find((s) => seen.get(s));
    links.forEach((a) => a.classList.toggle('on', !!first && a.getAttribute('href') === `#${first.id}`));
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach((s) => io.observe(s));
}
