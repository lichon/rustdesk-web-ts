
declare module 'zmodem.js/src/zmodem_browser' {
  export const Browser: {
    send_files: (session: unknown, files: FileList, options: unknown) => Promise<void>
  }
  export class Sentry {
    constructor(options: {
      sender: (data: string | Uint8Array) => void
      to_terminal: (data: never) => void
      on_retract: () => void
      on_detect: (detection: Detection) => void
    })
    consume: (data: string | ArrayBuffer | Uint8Array | Blob) => void
  }
  export type Detection = {
    deny: () => void
    confirm: () => Session
  }
  export type Session = {
    type: string
    on: (event: string, callback: (offer: Offer) => void) => void
    close: () => void
    start: () => void
  }
  export type Offer = {
    get_details: () => { name: string, size: number }
    get_offset: () => number
    accept: () => Promise<Uint8Array[]>
    on: (event: string, callback: () => void) => void
  }
}

declare module 'file-saver' {
  export function saveAs(blob: Blob, filename: string): void
}