/* Adds an app-wide stylesheet to <head>.

   Strapi 5 builds the admin index.html from its own template, which injects the
   entry <script> and nothing else. The CSS asset Vite emits for the entry chunk
   therefore gets no <link>, so `import './x.css'` from app.ts silently does
   nothing in a production build (it still works in `strapi develop`, where Vite
   injects styles at runtime — which is why this stayed unnoticed).

   Route-level stylesheets imported from a lazily-loaded screen are fine: those
   land in a dynamic chunk and Vite links them when the chunk loads. Only
   app-wide CSS needs this helper, paired with a `?inline` import so the
   stylesheet arrives as a string instead of an unreferenced asset. */

export const injectAdminStyleSheet = (id: string, css: string): void => {
  if (typeof document === 'undefined') {
    return;
  }

  if (document.getElementById(id)) {
    return;
  }

  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
};
