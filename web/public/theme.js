// Runs before first paint: apply the saved theme (or the system one) to avoid a flash.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* storage unavailable: fall back to light */
  }
})();
