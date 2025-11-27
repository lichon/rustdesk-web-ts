
type FnSetUrl = (url: string) => void

type TTYConfig = {
  url: string
  config: Record<string, unknown>,
  onAuthRequired: (prompt?: string) => Promise<string>
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

type ChannelMember = {
  id: string
  name: string
  image: string
}

interface TTYChannel {
  sendMessage: (message: string) => Promise<void>
  isConnected: () => boolean
  onlineMembers: () => ChannelMember[]
}

export type { TTYConfig, TTYOpen, TTY, FnSetUrl, TTYChannel }
