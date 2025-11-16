/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HBBS_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}