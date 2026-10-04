/* Adds a collapse/expand toggle to the Strapi main nav and remembers the
   choice. When expanded (default) the CSS in main-nav-labels.css reveals the
   text labels; when collapsed the nav falls back to Strapi's icon-only look. */

import { injectAdminStyleSheet } from './inject-admin-styles.helper';

/* `?inline` + manual injection, not `import './main-nav-labels.css'`: an
   app-wide stylesheet imported the plain way never reaches the browser in a
   production build. See inject-admin-styles.helper.ts. */
import navStyles from './main-nav-labels.css?inline';

const STYLE_ID = 'salanca-main-nav-styles';
const NAV_COLLAPSED_ATTR = 'data-salanca-nav-collapsed';
const STORAGE_KEY = 'salanca:mainNavCollapsed';
const TOGGLE_ID = 'salanca-main-nav-toggle';
/* Stable hooks for main-nav-labels.css. Strapi's own MainNav markup has no
   class we can rely on, and `nav:first-of-type` is fragile across upgrades,
   so we stamp our own id + class on the nav.

   The id is the selector the CSS relies on: `MainNav` is a styled-components
   `Flex`, so React owns its `class` attribute and rewrites it whenever the
   generated hash changes (responsive props, theme, `useIsDesktop`). That
   rewrite silently dropped `.salanca-main-nav` and left the nav stuck in the
   narrow icon rail while the toggle button — styled by id — stayed visible.
   React never writes `id` here, and the MutationObserver below re-stamps both
   on attribute changes anyway. */
const NAV_ID = 'salanca-main-nav';
const NAV_CLASS = 'salanca-main-nav';

let isSetupDone = false;

const readCollapsedPreference = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const persistCollapsedPreference = (collapsed: boolean): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable (private mode etc.) — ignore */
  }
};

const applyCollapsedState = (collapsed: boolean): void => {
  document.documentElement.toggleAttribute(NAV_COLLAPSED_ATTR, collapsed);
};

const toggleCollapsedState = (): void => {
  const next = !document.documentElement.hasAttribute(NAV_COLLAPSED_ATTR);
  applyCollapsedState(next);
  persistCollapsedPreference(next);
};

const buildToggleButton = (): HTMLButtonElement => {
  const button = document.createElement('button');
  button.id = TOGGLE_ID;
  button.type = 'button';
  button.setAttribute('aria-label', 'Thu gọn hoặc mở rộng menu');
  button.innerHTML =
    '<span class="salanca-nav-toggle-icon" aria-hidden="true">«</span>' +
    '<span class="salanca-nav-toggle-label">Thu gọn menu</span>';

  return button;
};

/* Re-stamps the hooks and (re-)injects the toggle. Cheap and idempotent: it
   only writes when something is actually missing, so the MutationObserver it
   feeds cannot loop on its own writes. */
const syncNav = (): void => {
  const nav = document.querySelector<HTMLElement>('nav');
  if (!nav) {
    return;
  }

  if (nav.id !== NAV_ID) {
    nav.id = NAV_ID;
  }

  if (!nav.classList.contains(NAV_CLASS)) {
    nav.classList.add(NAV_CLASS);
  }

  if (!nav.querySelector(`#${TOGGLE_ID}`)) {
    nav.appendChild(buildToggleButton());
  }
};

export const setupMainNavLabels = (): void => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (isSetupDone) {
    return;
  }
  isSetupDone = true;

  injectAdminStyleSheet(STYLE_ID, navStyles);
  applyCollapsedState(readCollapsedPreference());
  syncNav();

  /* Delegated so the handler survives React moving or replacing the nav, and
     so a re-injected button is wired up without re-binding anything. */
  document.addEventListener('click', (event) => {
    const target = event.target;

    if (!(target instanceof Element) || !target.closest(`#${TOGGLE_ID}`)) {
      return;
    }

    toggleCollapsedState();
  });

  const observer = new MutationObserver(() => {
    syncNav();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id'],
  });
};
