/**
 * 404 page.
 */
import { h, mount } from '../utils/dom.js';
import { navigate } from '../router.js';
import { NavBar } from '../components/NavBar.js';

export default async function NotFoundPage(container) {
  const page = h('div', { className: 'error-page' }, [
    h('h1', {}, ['404']),
    h('p', {}, ["this page doesn't exist"]),
    h('button', { className: 'btn btn-primary', onClick: () => navigate('/') }, ['go home']),
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
}