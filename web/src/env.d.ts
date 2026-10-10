/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "beta" on the beta stage's build, which then shows a Beta badge. Unset in production. */
  readonly VITE_STAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
