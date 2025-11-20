type TTYConfig = {
  url: string
  onAuthRequired: () => Promise<string>
  onSocketOpen?: () => void
  onSocketClose?: (reason?: string) => void
  onSocketData: (data: Uint8Array, buffer?: ArrayBuffer) => void
}

type TTYOpen = {
  cols: number
  rows: number
  targetId?: string
  useWebRTC?: boolean
}

export type { TTYConfig, TTYOpen }
