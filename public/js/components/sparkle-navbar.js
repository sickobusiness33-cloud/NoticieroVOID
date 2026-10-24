// SparkleNavbar — vanilla port of the supplied React/TypeScript component (VOID has no
// React build). Same API: items, color, activeIndex (controlled), onItemClick, ariaLabel,
// className. Same visuals: GSAP-animated glowing indicator with the SVG beam.
// Additions: items may be { label, href } (rendered as real links), a unique gradient id
// per instance, reduced-motion support, and destroy() to clean up observers and tweens.

let instances = 0;

export function createSparkleNavbar({
  items,
  color = '#00fffc',
  activeIndex: controlledActiveIndex,
  onItemClick,
  ariaLabel = 'Main navigation',
  className = '',
}) {
  const gradientId = `void-sparkle-beam-${++instances}`;
  let internalActiveIndex = 0;
  let controlled = controlledActiveIndex;
  const activeIndex = () => controlled ?? internalActiveIndex;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', ariaLabel);
  nav.className = `snav ${className}`.trim();
  const track = document.createElement('div');
  track.className = 'snav-track';
  const indicator = document.createElement('div');
  indicator.className = 'snav-ind';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.style.cssText = `width:0;opacity:0;background:linear-gradient(90deg, ${color}, #ffffff);box-shadow:0 0 8px ${color}, 0 0 18px ${color}55`;
  indicator.innerHTML = `<svg aria-hidden="true" class="snav-beam" viewBox="0 0 116 5" preserveAspectRatio="none">
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="116" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#ffffff"/></linearGradient></defs>
    <path d="M0 2.5 L116 0.5 L116 4.5 Z" fill="url(#${gradientId})"/></svg>`;
  track.append(indicator);
  nav.append(track);

  let buttons = [];
  let itemList = [];

  function render(list) {
    itemList = list;
    buttons.forEach((b) => b.remove());
    buttons = list.map((item, index) => {
      const label = typeof item === 'string' ? item : item.label;
      const href = typeof item === 'string' ? null : item.href;
      const el = document.createElement(href ? 'a' : 'button');
      if (href) el.href = href; else el.type = 'button';
      el.className = 'snav-item';
      el.textContent = label;
      el.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab etc.
        if (href && onItemClick) e.preventDefault();
        if (controlled === undefined) { internalActiveIndex = index; paint(); }
        onItemClick?.(item, index);
      });
      track.append(el);
      return el;
    });
    paint();
    observe();
  }

  function paint() {
    const ai = activeIndex();
    buttons.forEach((b, i) => {
      const on = i === ai;
      b.classList.toggle('on', on);
      if (on) { b.setAttribute('aria-current', 'page'); b.style.color = color; b.style.textShadow = `0 0 12px ${color}66`; }
      else { b.removeAttribute('aria-current'); b.style.color = ''; b.style.textShadow = ''; }
    });
    moveIndicator();
  }

  function moveIndicator() {
    const activeButton = buttons[activeIndex()];
    const gsap = window.gsap;
    if (!activeButton) {
      if (gsap) gsap.to(indicator, { opacity: 0, duration: reduceMotion ? 0 : 0.2, overwrite: 'auto' });
      else indicator.style.opacity = '0';
      return;
    }
    const navRect = track.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const x = buttonRect.left - navRect.left + track.scrollLeft;
    if (gsap) {
      gsap.to(indicator, { x, width: buttonRect.width, opacity: 1, duration: reduceMotion ? 0 : 0.38, ease: 'power3.out', overwrite: 'auto' });
    } else {
      // GSAP unavailable (blocked script): same end state with a CSS transition.
      indicator.style.transition = reduceMotion ? 'none' : 'transform .38s cubic-bezier(.215,.61,.355,1), width .38s, opacity .2s';
      indicator.style.transform = `translateX(${x}px)`;
      indicator.style.width = `${buttonRect.width}px`;
      indicator.style.opacity = '1';
    }
  }

  let resizeObserver = null;
  function observe() {
    resizeObserver?.disconnect();
    if (!('ResizeObserver' in window)) return;
    resizeObserver = new ResizeObserver(() => moveIndicator());
    resizeObserver.observe(track);
    buttons.forEach((b) => resizeObserver.observe(b));
  }
  window.addEventListener('resize', moveIndicator);
  // Web fonts change label widths after first paint.
  document.fonts?.ready.then(moveIndicator);

  render(items);

  return {
    el: nav,
    // Controlled mode: the router sets the active index from the URL.
    setActive(index) {
      controlled = index;
      paint();
      const b = buttons[index];
      if (b && track.scrollWidth > track.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    },
    setItems(list) { render(list); },
    get items() { return itemList; },
    destroy() {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', moveIndicator);
      window.gsap?.killTweensOf(indicator);
      nav.remove();
    },
  };
}
