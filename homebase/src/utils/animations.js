/**
 * GSAP animation helpers.
 * GSAP is loaded as an ES module from node_modules.
 */
import gsap from 'gsap';

export function staggerIn(container, items = '.fade-item', delay = 0) {
  return gsap.fromTo(
    container.querySelectorAll(items),
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, delay, ease: 'power3.out' }
  );
}

export function fadeUp(el, delay = 0) {
  return gsap.fromTo(
    el,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.6, delay, ease: 'power3.out' }
  );
}

export function fadeIn(el, delay = 0) {
  return gsap.fromTo(
    el,
    { opacity: 0 },
    { opacity: 1, duration: 0.4, delay, ease: 'power2.out' }
  );
}

export function scaleIn(el, delay = 0) {
  return gsap.fromTo(
    el,
    { opacity: 0, scale: 0.9 },
    { opacity: 1, scale: 1, duration: 0.4, delay, ease: 'back.out(1.7)' }
  );
}

export function hoverBloom(el) {
  el.addEventListener('mouseenter', () => {
    gsap.to(el, { scale: 1.02, duration: 0.2, ease: 'power2.out' });
  });
  el.addEventListener('mouseleave', () => {
    gsap.to(el, { scale: 1, duration: 0.2, ease: 'power2.out' });
  });
}

export function pageTransition(container) {
  return gsap.fromTo(
    container,
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }
  );
}