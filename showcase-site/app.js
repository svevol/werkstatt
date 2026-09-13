(function () {
  function initTheme() {
    var root = document.documentElement;
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      if (!btn) return;
      var saved = null;
      try {
        saved = localStorage.getItem('werkstatt-theme');
      } catch (err) {}
      if (saved === 'dark') {
        root.setAttribute('data-theme', 'dark');
        btn.setAttribute('aria-pressed', 'true');
        btn.textContent = 'Day';
      }
      btn.addEventListener('click', function () {
        var dark = root.getAttribute('data-theme') === 'dark';
        if (dark) {
          root.removeAttribute('data-theme');
          btn.setAttribute('aria-pressed', 'false');
          btn.textContent = 'Night';
          try {
            localStorage.setItem('werkstatt-theme', 'light');
          } catch (err) {}
        } else {
          root.setAttribute('data-theme', 'dark');
          btn.setAttribute('aria-pressed', 'true');
          btn.textContent = 'Day';
          try {
            localStorage.setItem('werkstatt-theme', 'dark');
          } catch (err) {}
        }
      });
    });
  }

  function initNav() {
    document.querySelectorAll('.site-header').forEach(function (header) {
      var toggle = header.querySelector('.nav-toggle');
      var nav = header.querySelector('.site-nav');
      if (!toggle || !nav) return;
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      nav.querySelectorAll('.nav-link').forEach(function (link) {
        link.addEventListener('click', function () {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    });
  }

  function initAccordions() {
    document.querySelectorAll('.accordion').forEach(function (root) {
      var btn = root.querySelector('.accordion-btn');
      var panel = root.querySelector('.accordion-panel');
      if (!btn || !panel) return;
      btn.addEventListener('click', function () {
        var open = root.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });
    });
  }

  function initTabs() {
    document.querySelectorAll('.tabs').forEach(function (tabs) {
      var buttons = tabs.querySelectorAll('.tab-btn');
      var panels = tabs.querySelectorAll('.tab-panel');
      if (!buttons.length || buttons.length !== panels.length) return;
      buttons.forEach(function (btn, index) {
        btn.addEventListener('click', function () {
          buttons.forEach(function (other, otherIndex) {
            other.setAttribute('aria-selected', otherIndex === index ? 'true' : 'false');
          });
          panels.forEach(function (panel, panelIndex) {
            if (panelIndex === index) panel.removeAttribute('hidden');
            else panel.setAttribute('hidden', '');
          });
        });
      });
    });
  }

  function initDropdowns() {
    document.querySelectorAll('.dropdown').forEach(function (root) {
      var btn = root.querySelector('.dropdown-btn');
      var menu = root.querySelector('.dropdown-menu');
      if (!btn || !menu) return;
      btn.addEventListener('click', function () {
        var open = root.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) menu.removeAttribute('hidden');
        else menu.setAttribute('hidden', '');
      });
    });
  }

  function initCarousels() {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.carousel').forEach(function (root) {
      var track = root.querySelector('.carousel-track');
      if (!track) return;
      root.querySelectorAll('.carousel-btn[data-scroll]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var dir = Number(btn.getAttribute('data-scroll'));
          if (!dir) return;
          track.scrollBy({
            left: dir * Math.max(220, track.clientWidth * 0.75),
            behavior: reduce ? 'auto' : 'smooth'
          });
        });
      });
    });
  }

  function initDialogs() {
    document.querySelectorAll('[data-open-dialog]').forEach(function (btn) {
      var id = btn.getAttribute('data-open-dialog');
      var dialog = id ? document.getElementById(id) : null;
      if (!dialog || typeof dialog.showModal !== 'function') return;
      btn.addEventListener('click', function () {
        dialog.showModal();
      });
    });
    document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dialog = btn.closest('dialog');
        if (!dialog) return;
        dialog.close();
      });
    });
  }

  function initForms() {
    document.querySelectorAll('.cta-form').forEach(function (form) {
      if (!form) return;
      form.addEventListener('submit', function (event) {
        event.preventDefault();
      });
    });
  }

  initTheme();
  initNav();
  initAccordions();
  initTabs();
  initDropdowns();
  initCarousels();
  initDialogs();
  initForms();
})();
