// The frame of boat-desktop.html (#564): boat.dev's desktop stream at the address in its fragment, an https one only.
// The fragment is dropped once read, so the address is not left in the frame's own address.
(() => {
  const url = new URLSearchParams(location.hash.slice(1)).get('u') || '';
  history.replaceState(null, '', location.pathname);
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return;
  const show = () => {
    const f = document.createElement('iframe');
    f.allow = 'autoplay; fullscreen; clipboard-read; clipboard-write';
    f.referrerPolicy = 'no-referrer';
    f.title = 'Screen';
    f.src = url;
    document.body.append(f);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
