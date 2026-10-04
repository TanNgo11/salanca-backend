/* Every `strapi build` emits new content hashes, and the deploy ships a fresh
   container, so the previous build's chunks are gone the moment a deploy lands.
   A tab that was already open then lazy-loads a chunk name that no longer
   exists; `strapi::public` answers 200 with index.html, and Vite throws
   "'text/html' is not a valid JavaScript MIME type" onto the crash screen.

   We suppress that crash and ask the user to reload rather than reloading for
   them: the failure can land while they are half-way through a form,
   and an unannounced reload would throw the draft away. The screen they were
   opening did not load either way, so the banner has to say what to do next. */

import { injectAdminStyleSheet } from './inject-admin-styles.helper';

/* `?inline` + manual injection, not `import './stale-chunk-reload.css'`: an
   app-wide stylesheet imported the plain way never reaches the browser in a
   production build. See inject-admin-styles.helper.ts. */
import bannerStyles from './stale-chunk-reload.css?inline';

const STYLE_ID = 'salanca-stale-chunk-styles';
const BANNER_ID = 'salanca-stale-chunk-banner';
const RELOAD_BUTTON_ID = 'salanca-stale-chunk-banner-reload';
const BANNER_MESSAGE =
  'Trang quản trị vừa được cập nhật nên màn hình này chưa mở được. Lưu phần đang làm rồi tải lại trang.';
const RELOAD_LABEL = 'Tải lại';

let isSetupDone = false;

export const shouldShowStaleChunkBanner = (alreadyShown: boolean): boolean => !alreadyShown;

const buildBanner = (onReload: () => void): HTMLElement => {
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  /* `alert` rather than `status`: the user cannot carry on with the screen they
     asked for, so a screen reader should announce this straight away. */
  banner.setAttribute('role', 'alert');

  const message = document.createElement('span');
  message.textContent = BANNER_MESSAGE;

  const reload = document.createElement('button');
  reload.id = RELOAD_BUTTON_ID;
  reload.type = 'button';
  reload.textContent = RELOAD_LABEL;
  reload.addEventListener('click', onReload);

  banner.append(message, reload);
  return banner;
};

const showBanner = (): void => {
  if (document.getElementById(BANNER_ID)) {
    return;
  }

  injectAdminStyleSheet(STYLE_ID, bannerStyles);
  document.body.appendChild(buildBanner(() => window.location.reload()));
};

export const watchStaleChunkPreloadErrors = (): void => {
  if (typeof window === 'undefined' || isSetupDone) {
    return;
  }

  isSetupDone = true;

  window.addEventListener('vite:preloadError', (event) => {
    if (!shouldShowStaleChunkBanner(document.getElementById(BANNER_ID) !== null)) {
      return;
    }

    // Suppress Vite's default rethrow so the Admin error boundary never paints
    // the crash screen over the banner.
    event.preventDefault();
    showBanner();
  });
};
