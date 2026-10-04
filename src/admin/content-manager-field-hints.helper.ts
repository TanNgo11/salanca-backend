import { injectAdminStyleSheet } from './inject-admin-styles.helper';

/* `?inline` + manual injection, not `import './content-manager-field-hints.css'`:
   an app-wide stylesheet imported the plain way never reaches the browser in a
   production build. See inject-admin-styles.helper.ts. */
import fieldHintStyles from './content-manager-field-hints.css?inline';

const STYLE_ID = 'salanca-content-manager-field-hint-styles';
const CONTENT_MANAGER_FIELD_HINTS_ATTR = 'data-cm-hide-field-hints';

export const shouldHideContentManagerFieldHints = (pathname: string): boolean =>
  pathname.includes('/content-manager');

export const syncContentManagerFieldHintVisibility = (): void => {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.toggleAttribute(
    CONTENT_MANAGER_FIELD_HINTS_ATTR,
    shouldHideContentManagerFieldHints(window.location.pathname),
  );
};

export const watchContentManagerFieldHintVisibility = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  injectAdminStyleSheet(STYLE_ID, fieldHintStyles);
  syncContentManagerFieldHintVisibility();
  window.addEventListener('popstate', syncContentManagerFieldHintVisibility);

  const patchHistoryMethod = (method: 'pushState' | 'replaceState'): void => {
    const original = history[method].bind(history) as History['pushState'];

    history[method] = ((...args: Parameters<History['pushState']>) => {
      const result = original(...args);
      syncContentManagerFieldHintVisibility();
      return result;
    }) as History['pushState'];
  };

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
};
