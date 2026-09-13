// Demo site script — runs in Preview mode only (blocked while editing).
(function () {
  const btn = document.querySelector('.hero .btn');
  const sub = document.querySelector('.hero-sub');
  if (!btn || !sub) return;

  let n = 0;
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    n += 1;
    sub.textContent =
      n === 1
        ? 'Preview is live — this text was changed by app.js.'
        : 'Clicked ' + n + ' times. Switch to Edit (⌘E) to style the page.';
    btn.textContent = n === 1 ? 'It works' : 'Again (' + n + ')';
  });
})();
