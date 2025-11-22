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

export type { TTYConfig, TTYOpen }
