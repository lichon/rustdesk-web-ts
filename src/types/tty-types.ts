type TTYConfig = {
  url: string
  onAuthRequired: () => Promise<string>
  onSocketOpen?: () => void
  onSocketClose?: (reason?: string) => void
  onSocketData: (data: Uint8Array) => void
}

type TTYOpen = {
  cols: number
  rows: number
  targetId?: string
}

export type { TTYConfig, TTYOpen }
