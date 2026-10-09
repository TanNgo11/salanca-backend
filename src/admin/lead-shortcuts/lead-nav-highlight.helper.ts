import { contactMessageUid, leadListPath, reservationRequestUid } from './lead-shortcuts.helper';

/* The lead sidebar shortcuts forward to the Content Manager, so react-router
   marks the Content Manager link active instead of the shortcut. This moves
   Strapi's own `active` class (and aria-current) to the shortcut while a lead
   list or edit view is open, so the highlight keeps Strapi's styling in both
   themes. React only rewrites a NavLink's class when its computed value
   changes, so the swap holds until the next navigation, where syncLeadNav
   runs again from the MutationObserver. */

const ACTIVE_CLASS = 'active';
const CONTENT_MANAGER_HREF_SUFFIX = '/content-manager';

export const LEAD_SHORTCUT_PATHS: Readonly<Record<string, string>> = {
  [reservationRequestUid]: '/plugins/reservation-requests',
  [contactMessageUid]: '/plugins/contact-messages',
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Shortcut path that owns `pathname`, or null outside the lead views. */
export const activeLeadShortcut = (rawPathname: string): string | null => {
  const pathname = safeDecode(rawPathname);
  for (const [uid, shortcutPath] of Object.entries(LEAD_SHORTCUT_PATHS)) {
    const listPath = leadListPath(uid);
    const index = pathname.indexOf(listPath);
    if (index === -1) {
      continue;
    }
    const rest = pathname.slice(index + listPath.length);
    if (rest === '' || rest.startsWith('/')) {
      return shortcutPath;
    }
  }
  return null;
};

const setActive = (link: HTMLAnchorElement, active: boolean): void => {
  if (link.classList.contains(ACTIVE_CLASS) !== active) {
    link.classList.toggle(ACTIVE_CLASS, active);
  }
  const current = link.getAttribute('aria-current');
  if (active && current !== 'page') {
    link.setAttribute('aria-current', 'page');
  } else if (!active && current !== null) {
    link.removeAttribute('aria-current');
  }
};

const findNavLink = (nav: Element, hrefSuffix: string): HTMLAnchorElement | null =>
  Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]')).find((link) =>
    (link.getAttribute('href') ?? '').endsWith(hrefSuffix),
  ) ?? null;

/* Idempotent: only writes when the DOM differs, so the observer that calls it
   does not loop on its own writes. Outside the lead views it puts the Content
   Manager link back to what react-router says. */
const syncLeadNav = (): void => {
  const nav = document.querySelector('nav');
  if (!nav) {
    return;
  }
  const pathname = window.location.pathname;
  const activeShortcut = activeLeadShortcut(pathname);

  for (const shortcutPath of Object.values(LEAD_SHORTCUT_PATHS)) {
    const link = findNavLink(nav, shortcutPath);
    if (link) {
      setActive(link, shortcutPath === activeShortcut);
    }
  }

  const contentManagerLink = findNavLink(nav, CONTENT_MANAGER_HREF_SUFFIX);
  if (contentManagerLink) {
    const onContentManager = pathname.includes(`${CONTENT_MANAGER_HREF_SUFFIX}/`) ||
      pathname.endsWith(CONTENT_MANAGER_HREF_SUFFIX);
    setActive(contentManagerLink, onContentManager && activeShortcut === null);
  }
};

let isWatching = false;

export const watchLeadNavHighlight = (): void => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || isWatching) {
    return;
  }
  isWatching = true;

  syncLeadNav();
  window.addEventListener('popstate', syncLeadNav);
  new MutationObserver(syncLeadNav).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-current'],
  });
};
