(() => {
  const nav = document.querySelector('.nav');
  const links = nav?.querySelector('.nav-links');
  if (!links) return;
  links.id = 'site-navigation';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-menu-toggle';
  button.textContent = 'Menu';
  button.setAttribute('aria-controls', links.id);
  button.setAttribute('aria-expanded', 'false');
  links.before(button);
  function close() { links.classList.remove('menu-open'); button.setAttribute('aria-expanded', 'false'); }
  button.addEventListener('click', () => {
    const open = links.classList.toggle('menu-open');
    button.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  nav.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.focus(); } });
  document.addEventListener('click', event => { if (!nav.contains(event.target)) close(); });
})();
