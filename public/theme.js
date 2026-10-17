// Apply the saved theme before first paint to avoid a flash.
try { const t = localStorage.getItem('botdot.theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
