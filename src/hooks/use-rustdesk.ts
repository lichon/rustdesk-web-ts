import { useEffect, useRef } from 'react'
import * as rendezvous from './hbbs-rendezvous'
import * as deskMsg from './hbbs-message'
import type { TTYConfig, TTYOpen } from '../types/tty-types'

import { Zstd } from "@hpcc-js/wasm-zstd";

type RustSession = {
  targetId: string
  relayUrl: string
  uuid: string
  socket?: WebSocket
  serviceId?: string
  sessionId?: bigint
  closeReason?: string
  isOpen(): boolean
  close(): void
  send(data: string): void
}

class RustSessionImpl implements RustSession {
  targetId: string
  relayUrl: string
  uuid: string
  socket?: WebSocket
  serviceId?: string
  sessionId?: bigint
  closeReason?: string

  constructor(targetId: string, relayUrl: string, uuid: string) {
    this.targetId = targetId
    this.relayUrl = relayUrl
    this.uuid = uuid
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING
  }

  close(): void {
    this.socket?.close()
  }

  send(data: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN)
      return
    const dataBytes = new TextEncoder().encode(data)
    sendSocketMsg({
      terminalAction: deskMsg.TerminalAction.create({
        union: {
          oneofKind: 'data',
          data: deskMsg.TerminalData.create({
            data: dataBytes
          })
        }
      })
    }, this.socket)
  }

  start(ttyConfig: TTYConfig, openRequest: TTYOpen): void {
    const socket = this.socket = new WebSocket(this.relayUrl)
    const uuid = this.uuid
    const sessionId = this.sessionId = BigInt(Date.now())

    const handleChallenge = async ({ salt, challenge }: { salt: string, challenge: string }) => {
      const userPass = await ttyConfig.onAuthRequired?.()
      // for demo purposes, we use a fixed password
      const encoder = new TextEncoder()
      const passBytes = encoder.encode(userPass)

      const saltedPass = new Uint8Array(salt.length + passBytes.length)
      // pass first
      saltedPass.set(passBytes, 0)
      saltedPass.set(encoder.encode(salt), passBytes.length)
      // hashed password
      const hashedSaltedPass = await crypto.subtle.digest('SHA-256', saltedPass)
      const hashArray = new Uint8Array(hashedSaltedPass)
      // combine with challenge
      const challengePass = new Uint8Array(challenge.length + hashArray.length)
      challengePass.set(hashArray, 0)
      challengePass.set(encoder.encode(challenge), hashArray.length)

      return await crypto.subtle.digest('SHA-256', challengePass)
    }

    const handleLoginResponse = (session: RustSession, loginResp: deskMsg.LoginResponse) => {
      if (loginResp.union.oneofKind === 'peerInfo') {
        console.log('Login successful')
        ttyConfig.onSocketOpen?.()
        return true
      }
      if (loginResp.union.oneofKind === 'error') {
        console.log(`Login failed: ${loginResp.union.error}`)
        session.closeReason = `Login failed: ${loginResp.union.error}`
      } else {
        console.log(`Login failed: unknown reason`)
        session.closeReason = `Login failed: unknown reason`
      }
      session.close()
      return false
    }

    const handleTerminalResponse = (session: RustSession, terminalResp: deskMsg.TerminalResponse) => {
      switch (terminalResp.union.oneofKind) {
        case 'opened':
          session.serviceId = terminalResp.union.opened.serviceId
          console.log('Terminal opened', terminalResp.union.opened)
          break
        case 'data':
          if (terminalResp.union.data?.compressed) {
            const compressed = terminalResp.union.data?.data
            Zstd.load().then((zstd) => {
              ttyConfig.onSocketData(zstd.decompress(compressed))
            })
          } else {
            ttyConfig.onSocketData(terminalResp.union.data!.data || new Uint8Array())
          }
          break
        case 'closed':
          console.log('Terminal closed by server')
          session.closeReason = 'Terminal closed by server'
          session.close()
          break
        case 'error':
          console.log(`Terminal session error:`, terminalResp.union.error.message)
          session.closeReason = `Terminal error: ${terminalResp.union.error.message}`
          session.close()
          break
        default:
          console.warn(`Unhandled terminal response: ${terminalResp.union.oneofKind}`)
      }
    }

    socket.onopen = () => {
      // relay request
      sendSocketMsg({
        requestRelay: rendezvous.RequestRelay.create({ uuid })
      }, socket, true)
      // login request
      sendSocketMsg({
        loginRequest: deskMsg.LoginRequest.create({
          username: this.targetId,
          myId: 'web',
          myName: 'web',
          myPlatform: 'web',
          version: '1.4.4',
          union: {
            oneofKind: "terminal",
            terminal: {
              serviceId: '',
            }
          },
          sessionId: sessionId,
        })
      }, socket)
    }

    socket.onmessage = async (event: MessageEvent) => {
      const dataBytes = new Uint8Array(await event.data.arrayBuffer())
      const msg = deskMsg.Message.fromBinary(dataBytes)
      if (msg.union.oneofKind !== 'testDelay') {
        console.log(`rustdesk on message ${msg.union.oneofKind}`, msg)
      }
      switch (msg.union.oneofKind) {
        case 'testDelay':
          // echo back the testDelay message
          sendSocketMsg({
            testDelay: deskMsg.TestDelay.create({
              lastDelay: msg.union.testDelay!.lastDelay
            })
          }, socket)
          break
        case 'hash':
          handleChallenge(msg.union.hash!).then((hashedChallenge) => {
            sendSocketMsg({
              loginRequest: deskMsg.LoginRequest.create({
                username: this.targetId,
                myId: 'web',
                myName: 'web',
                myPlatform: 'web',
                version: '1.4.4',
                password: new Uint8Array(hashedChallenge),
                sessionId: sessionId,
              })
            }, socket)
          })
          break
        case 'loginResponse':
          if (handleLoginResponse(this, msg.union.loginResponse!)) {
            // Handle successful login
            sendSocketMsg({
              terminalAction: deskMsg.TerminalAction.create({
                union: {
                  oneofKind: 'open',
                  open: deskMsg.OpenTerminal.create({
                    cols: openRequest.cols,
                    rows: openRequest.rows,
                  })
                },
              })
            }, socket)
          }
          break
        case 'terminalResponse':
          handleTerminalResponse(this, msg.union.terminalResponse!)
          break
        case 'misc':
          if (msg.union.misc?.union.oneofKind === 'closeReason') {
            const closeReason = msg.union.misc?.union.closeReason
            console.log(`Terminal closed: ${closeReason}`)
          }
          break
        default:
          console.warn(`Unhandled message type: ${msg.union.oneofKind}`)
      }
    }

    socket.onclose = () => {
      console.log(`tty socket closed`)
      ttyConfig.onSocketClose?.(this.closeReason || '')
    }

    socket.onerror = (error) => {
      this.closeReason = `Socket error occurred: ${error.type}`
      socket.close()
    }
  }
}

const useRustDesk = (ttyConfig: TTYConfig) => {
  const activeSession = useRef<RustSession | null>(undefined)
  const currentRequest = useRef<TTYOpen | undefined>(undefined)

  useEffect(() => {
  }, [])


  const open = async (ttyOpen: TTYOpen) => {
    if (currentRequest.current) {
      return
    }
    currentRequest.current = ttyOpen

    const targetId = ttyOpen.targetId || 'a123123'
    if (activeSession.current?.isOpen()) {
      activeSession.current.close()
      console.warn(`TTY socket on, closing existing socket`)
    }

    const punchResponse = await sendRendezvousRequest(ttyConfig.url, {
      punchHoleRequest: rendezvous.PunchHoleRequest.create({
        id: targetId,
        natType: rendezvous.NatType.SYMMETRIC,
        connType: rendezvous.ConnType.TERMINAL,
      })
    })
    const msg = punchResponse as rendezvous.RendezvousMessage
    try {
      if (!['punchHoleResponse', 'relayResponse'].includes(msg.union.oneofKind || '')) {
        throw new Error(`Unexpected response: ${msg.union.oneofKind}`)
      }
      if (msg.union.oneofKind === 'punchHoleResponse') {
        const resp = msg.union.punchHoleResponse!
        if (resp.otherFailure || resp.failure) {
          throw new Error(`${resp.otherFailure || resp.failure.toString()}`)
        }
      }

      if (msg.union.oneofKind === 'relayResponse') {
        const relayServer = msg.union.relayResponse!.relayServer
        if (!relayServer) {
          throw new Error('No relay server provided')
        }
        const session = new RustSessionImpl(targetId, relayServer, msg.union.relayResponse!.uuid)
        session.start(ttyConfig, ttyOpen)
        activeSession.current = session
      }
    } finally {
      currentRequest.current = undefined
    }
  }

  const send = (data: string) => {
    activeSession.current?.send(data)
  }

  const close = () => {
    activeSession.current?.close()
  }

  return { open, close, send }
}

const sendRendezvousRequest = (serverUrl: string, data: unknown, timeoutMs: number = 30000) => {
  if (!data) {
    return new Promise((_, reject) => {
      reject(new Error('No data provided for request'))
    })
  }
  console.log(`Sending request to ${serverUrl}`, data)
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(serverUrl)
    socket.onopen = () => {
      console.log('rendezvous connected')
      const type = Object.keys(data)[0]
      const msg = {
        union: {
          oneofKind: type,
          ...data
        }
      } as rendezvous.RendezvousMessage
      socket.send(rendezvous.RendezvousMessage.toBinary(msg))
    }
    socket.onmessage = async (event: MessageEvent) => {
      const dataBytes = new Uint8Array(await event.data.arrayBuffer())
      const msg = rendezvous.RendezvousMessage.fromBinary(dataBytes)
      console.log(`rendezvous on response ${msg.union.oneofKind}`, msg)
      if (msg.union.oneofKind) {
        resolve(msg)
      } else {
        reject(new Error(`Unexpected message type ${msg.union.oneofKind}`))
      }
      socket.close()
    }
    socket.onerror = (error) => {
      reject(error)
    }
    // timeout after 30 seconds
    setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
  })
}

const sendSocketMsg = (data: object, socket: WebSocket, isRendezvous: boolean = false) => {
  const type = Object.keys(data)[0]
  if (type !== 'testDelay') {
    console.log(`Sending socket message ${type}`, data)
  }
  let binaryMessage: Uint8Array
  if (isRendezvous) {
    binaryMessage = rendezvous.RendezvousMessage.toBinary({
      union: {
        oneofKind: type,
        ...data
      }
    } as rendezvous.RendezvousMessage)
  } else {
    binaryMessage = deskMsg.Message.toBinary({
      union: {
        oneofKind: type,
        ...data
      }
    } as deskMsg.Message)
  }
  socket.send(binaryMessage)
}

export default useRustDesk