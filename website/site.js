(() => {
  // The name spans the page's content width whatever system face it lands in.
  const names = document.querySelectorAll('.monument');
  const fit = () => names.forEach(name => {
    name.style.fontSize = '';
    const size = parseFloat(getComputedStyle(name).fontSize);
    name.style.fontSize = `${size * name.clientWidth / name.firstElementChild.getBoundingClientRect().width}px`;
  });
  fit();
  addEventListener('resize', fit);

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
