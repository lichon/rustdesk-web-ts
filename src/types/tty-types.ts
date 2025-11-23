type TTYConfig = {
  url: string
  config: Record<string, unknown>,
  onAuthRequired: () => Promise<string>
  onSocketOpen?: () => void
  onSocketClose?: (reason?: string) => void
  onSocketData: (data: Uint8Array, buffer?: ArrayBuffer) => void
}

type TTYOpen = {
  cols: number
  rows: number
  targetId?: string
}

type TTY = {
  open: (openConfig: TTYOpen) => Promise<void>
  close: () => void
  send: (data: string | Uint8Array) => void
  sendRaw: (data: Uint8Array) => void
}

type FnSetUrl = (url: string) => void

export type { TTYConfig, TTYOpen, TTY, FnSetUrl }
