import { useRef } from 'react'
import type { TTYConfig, TTYOpen } from '../types/tty-types'

const useTTY = (ttyConfig: TTYConfig) => {
  const ttySocket = useRef<WebSocket | null>(null)

  const open = async (ttyOpen: TTYOpen) => {
    if (ttySocket.current && ttySocket.current.readyState in [WebSocket.OPEN, WebSocket.CONNECTING]) {
      ttySocket.current?.close()
      console.warn(`TTY socket was ${ttySocket.current?.readyState}, closing existing socket`)
    }
    const socket = new WebSocket(`${ttyConfig.url}`, 'tty')
    ttySocket.current = socket
    console.log('new tty socket', socket)

    socket.onopen = () => {
      console.log('tty socket opened', ttyOpen.cols, ttyOpen.rows)
      socket.send(new TextEncoder().encode(
        JSON.stringify({
          AuthToken: '',
          columns: ttyOpen.cols,
          rows: ttyOpen.rows
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
      ttyConfig.onSocketClose?.('')
    }

    socket.onerror = (error) => {
      console.error('tty socket Error: ', error)
      ttyConfig.onSocketClose?.('socket error')
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