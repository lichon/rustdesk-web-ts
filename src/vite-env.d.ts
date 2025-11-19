/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_TTY_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}