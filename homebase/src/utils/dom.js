/**
 * Lightweight DOM helper — create elements, mount, unmount.
 */

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = val;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, val);
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(el.style, val);
    } else if (key === 'innerHTML') {
      el.innerHTML = val;
    } else if (key === 'htmlFor') {
      el.setAttribute('for', val);
    } else if (key === 'value') {
      el.value = val;
    } else {
      el.setAttribute(key, val);
    }
  }

  if (typeof children === 'string') {
    el.textContent = children;
  } else if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    }
  }

  return el;
}

export function mount(root, content) {
  root.innerHTML = '';
  if (typeof content === 'string') {
    root.innerHTML = content;
  } else if (content instanceof Node) {
    root.appendChild(content);
  } else if (Array.isArray(content)) {
    for (const c of content) {
      if (c instanceof Node) root.appendChild(c);
    }
  }
}

export function $el(selector, parent = document) {
  return parent.querySelector(selector);
}

export function $$el(selector, parent = document) {
  return parent.querySelectorAll(selector);
}

export function show(el) {
  if (el) el.style.display = '';
}

export function hide(el) {
  if (el) el.style.display = 'none';
}