import { useRef } from 'react'
import type { TTYConfig, TTYOpen } from '../types/tty-types'

enum ServerCommand {
  // server side
  OUTPUT = '0',
  SET_WINDOW_TITLE = '1',
  SET_PREFERENCES = '2',
}

enum ClientCommand {
  // client side
  INPUT = '0',
  RESIZE_TERMINAL = '1',
  PAUSE = '2',
  RESUME = '3',
}

const useTTY = (ttyConfig: TTYConfig) => {
  const ttySocket = useRef<WebSocket | null>(null)
  const textEncoder = new TextEncoder()
  const textDecoder = new TextDecoder()

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
      socket.send(textEncoder.encode(
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
      const arrayBuffer = await eventData.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const msgType = bytes.at(0)
      switch (msgType) {
        case ServerCommand.OUTPUT.charCodeAt(0):
          ttyConfig.onSocketData(bytes.slice(1), arrayBuffer)
          break
        case ServerCommand.SET_WINDOW_TITLE.charCodeAt(0):
          console.log('set title:', textDecoder.decode(bytes.slice(1)))
          break
        case ServerCommand.SET_PREFERENCES.charCodeAt(0):
          console.log('set config:', textDecoder.decode(bytes.slice(1)))
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

  const send = (data: string | Uint8Array) => {
    const socket = ttySocket.current
    if (socket?.readyState != WebSocket.OPEN) {
      return
    }
    if (typeof data === 'string') {
      socket.send(textEncoder.encode(ClientCommand.INPUT + data))
    } else {
      const payload = new Uint8Array(data.length + 1);
      payload[0] = ClientCommand.INPUT.charCodeAt(0);
      payload.set(data, 1);
      socket.send(payload);
    }
  }

  const close = () => {
    console.log('close tty socket called')
    ttySocket.current?.close()
  }

  return { open, close, send }
}

export default useTTY