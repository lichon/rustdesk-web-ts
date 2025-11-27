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

const useTTYD = (ttyConfig: TTYConfig) => {
  let ttySocket: WebSocket | null = null
  const textEncoder = new TextEncoder()
  const textDecoder = new TextDecoder()

  const open = async (ttyOpen: TTYOpen) => {
    if (ttySocket && ttySocket.readyState in [WebSocket.OPEN, WebSocket.CONNECTING]) {
      ttySocket.close()
      console.warn(`TTY socket was ${ttySocket.readyState}, closing existing socket`)
    }
    const ttydUrl = new URL(ttyConfig.url.replace('ttyd://', 'http://').replace('ttyds://', 'https://'))
    if (ttyConfig.config.cname) {
      const cnameRes = await fetch('/api/nslookup?host=' + ttydUrl.hostname)
      if (cnameRes.ok) {
        const cnameData = await cnameRes.json()
        cnameData.Answer?.forEach((ans: { type: number, data: string }) => {
          if (ans.type === 5) { // CNAME record
            ttydUrl.hostname = ans.data.replace(/\.$/, '') // remove trailing dot
          }
        })
      }
    }

    const corsUrl = '/ttyd/' + encodeURIComponent(ttydUrl.href)
    const tokenObj: { token?: string } = {}
    // CORS request to get token
    const res = await fetch(corsUrl + '/token')
    if (res.ok) {
      tokenObj.token = (await res.json()).token
    }
    if (tokenObj.token === undefined) {
      ttyConfig.onSocketClose?.('Login failed: no token received')
      return
    }

    const socket = new WebSocket(corsUrl + '/ws', 'tty')
    socket.binaryType = 'arraybuffer'
    ttySocket = socket
    console.log('new tty socket', socket)

    socket.onopen = () => {
      console.log('tty socket opened', ttyOpen.cols, ttyOpen.rows)
      socket.send(textEncoder.encode(
        JSON.stringify({
          AuthToken: tokenObj.token,
          columns: ttyOpen.cols,
          rows: ttyOpen.rows
        })))
      ttyConfig.onSocketOpen?.()
    }

    socket.onmessage = async (event: MessageEvent) => {
      if (event.data.size < 1) {
        return
      }
      const bytes = new Uint8Array(event.data)
      const msgType = bytes.at(0)
      switch (msgType) {
        case ServerCommand.OUTPUT.charCodeAt(0):
          ttyConfig.onSocketData(bytes.slice(1))
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
    const socket = ttySocket
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
    ttySocket?.close()
  }

  const sendRaw = async (_dataObj: object) => {
  }

  return { open, close, send, sendRaw }
}

export default useTTYD