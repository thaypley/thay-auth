/**
 * Simple reactive store for global state.
 */
const state = {
  user: null,
  profile: null,
  apps: [],
  devices: [],
  loading: false,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(update) {
  Object.assign(state, update);
  for (const fn of listeners) {
    try { fn(state); } catch { /* ignore */ }
  }
}

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}