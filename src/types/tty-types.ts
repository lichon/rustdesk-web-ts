type TTYConfig = {
  url: string
  debug?: boolean
  onAuthRequired: () => Promise<string>
  onSocketOpen?: () => void
  onSocketClose?: (reason?: string) => void
  onSocketData: (data: Uint8Array) => void
}

type TTYOpen = {
  cols: number
  rows: number
  targetId?: string
  useWebRTC?: boolean
}

export type { TTYConfig, TTYOpen }
