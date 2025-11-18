import { useRef } from 'react'

type TTYConfig = {
  url: string
  onSocketOpen?: () => void
  onSocketClose?: () => void
  onSocketData: (data: Uint8Array) => void
}

const useTTY = (ttyConfig: TTYConfig) => {
  const ttySocket = useRef<WebSocket | null>(null)

  const open = (cols: number = 80, rows: number = 24) => {
    if (ttySocket.current && ttySocket.current.readyState in [WebSocket.OPEN, WebSocket.CONNECTING]) {
      ttySocket.current?.close()
      console.warn(`TTY socket was ${ttySocket.current?.readyState}, closing existing socket`)
    }
    const socket = new WebSocket(`${ttyConfig.url}`, 'tty')
    console.log('new tty socket', socket)
    ttySocket.current = socket

    socket.onopen = () => {
      console.log('tty socket opened', cols, rows)
      socket.send(new TextEncoder().encode(
        JSON.stringify({
          AuthToken: '',
          columns: cols,
          rows: rows
        })))
      ttyConfig.onSocketOpen?.()
    }

    socket.onmessage = async (event: MessageEvent) => {
      const eventData = event.data as Blob
      if (eventData.size < 1) {
        return
      }
      const bytes = new Uint8Array(await eventData.arrayBuffer())
      const msgType = bytes.at(0)
      switch (msgType) {
        case '0'.charCodeAt(0):
          ttyConfig.onSocketData(bytes.slice(1))
          break
        case '1'.charCodeAt(0):
          console.log('info:', new TextDecoder().decode(bytes.slice(1)))
          break
        case '2'.charCodeAt(0):
          console.log('is windows:', new TextDecoder().decode(bytes.slice(1)))
          break
        default:
          console.warn('Unknown message type:', msgType)
      }
    }

    socket.onclose = () => {
      console.log('tty socket closed')
      ttyConfig.onSocketClose?.()
    }

    socket.onerror = (error) => {
      console.error('tty socket Error: ', error)
      ttyConfig.onSocketClose?.()
    }
  }

  const send = (data: string) => {
    if (ttySocket.current?.readyState === WebSocket.OPEN) {
      ttySocket.current?.send(new TextEncoder().encode('0' + data))
    }
  }

  const close = () => {
    console.log('close tty socket called')
    ttySocket.current?.close()
  }

  return { open, close, send }
}

export default useTTY