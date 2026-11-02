(() => {
  // Content only hides once this script is running, so it can never stay hidden without it.
  const parts = document.querySelectorAll('[data-rise]');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const watcher = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('risen');
    watcher.unobserve(entry.target);
  }), {rootMargin: '0px 0px -6% 0px'});
  document.documentElement.classList.add('rises');
  parts.forEach(part => {
    const siblings = [...part.parentElement.children].filter(child => child.hasAttribute('data-rise'));
    part.style.setProperty('--delay', `${siblings.indexOf(part) * 75}ms`);
    watcher.observe(part);
  });
})();
