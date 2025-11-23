import { useRef } from 'react'
import type { TTYConfig, TTYOpen } from '../types/tty-types'

// TODO support webtty
const useWebTTY = (ttyConfig: TTYConfig) => {
  const ttySocket = useRef<WebSocket | null>(null)

  const open = async (ttyOpen: TTYOpen) => {
    const socket = new WebSocket(ttyConfig.url)
    ttySocket.current = socket

    socket.onopen = () => {
      console.log('webtty socket opened', ttyOpen.cols, ttyOpen.rows)
      // TODO
      ttyConfig.onSocketOpen?.()
    }

    socket.onmessage = async (_event: MessageEvent) => {
      // const bytes = new Uint8Array(event.data)
    }

    socket.onclose = () => {
      ttyConfig.onSocketClose?.('')
    }

    socket.onerror = (error) => {
      console.error('tty socket Error: ', error)
      ttyConfig.onSocketClose?.('socket error')
    }
  }

  const send = (_data: string | Uint8Array) => {
    const socket = ttySocket.current
    if (socket?.readyState != WebSocket.OPEN) {
      return
    }
  }

  const close = () => {
    console.log('close webtty socket called')
  }

  const sendRaw = async (_dataObj: object) => {
  }

  return { open, close, send, sendRaw }
}

export default useWebTTY