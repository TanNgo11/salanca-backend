// Minimal typing for the Vite env that Strapi's admin bundler injects;
// `vite/client` types are not resolvable from this project under pnpm.
interface ImportMetaEnv {
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  readonly strapi: { readonly backendURL: string };
}

/* `?inline` hands the stylesheet over as a string instead of emitting a CSS
   asset. Needed for stylesheets that must apply app-wide: Strapi writes its own
   admin index.html and only injects the entry <script>, so the CSS asset Vite
   emits for the entry chunk is never linked. See inject-admin-styles.helper.ts. */
declare module '*.css?inline' {
  const content: string;
  export default content;
}
