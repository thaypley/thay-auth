/**
 * GSAP animation helpers.
 * GSAP is loaded as an ES module from node_modules.
 */
import gsap from 'gsap';

function isElement(el) {
  return el && typeof el === 'object' && el.nodeType === 1;
}

export function staggerIn(container, items = '.fade-item', delay = 0) {
  // Guard: a missing/empty target must never reach GSAP — an empty NodeList
  // makes GSAP log "[object NodeList] not found" and re-render it every tick.
  if (!isElement(container)) return null;
  const targets = container.querySelectorAll(items);
  if (!targets.length) return null;
  return gsap.fromTo(
    targets,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, delay, ease: 'power3.out' }
  );
}

export function fadeUp(el, delay = 0) {
  if (!isElement(el)) return null;
  return gsap.fromTo(
    el,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.6, delay, ease: 'power3.out' }
  );
}

export function fadeIn(el, delay = 0) {
  if (!isElement(el)) return null;
  return gsap.fromTo(
    el,
    { opacity: 0 },
    { opacity: 1, duration: 0.4, delay, ease: 'power2.out' }
  );
}

export function scaleIn(el, delay = 0) {
  if (!isElement(el)) return null;
  return gsap.fromTo(
    el,
    { opacity: 0, scale: 0.9 },
    { opacity: 1, scale: 1, duration: 0.4, delay, ease: 'back.out(1.7)' }
  );
}

export function hoverBloom(el) {
  if (!isElement(el)) return;
  el.addEventListener('mouseenter', () => {
    gsap.to(el, { scale: 1.02, duration: 0.2, ease: 'power2.out' });
  });
  el.addEventListener('mouseleave', () => {
    gsap.to(el, { scale: 1, duration: 0.2, ease: 'power2.out' });
  });
}

export function pageTransition(container) {
  if (!isElement(container)) return null;
  return gsap.fromTo(
    container,
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }
  );
}