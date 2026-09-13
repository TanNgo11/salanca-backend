// Minimal typing for the Vite env that Strapi's admin bundler injects;
// `vite/client` types are not resolvable from this project under pnpm.
interface ImportMetaEnv {
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
