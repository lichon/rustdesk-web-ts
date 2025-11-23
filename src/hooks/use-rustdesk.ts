import { useEffect, useRef } from 'react'
import * as rendezvous from './hbbs-rendezvous'
import * as deskMsg from './hbbs-message'
import type { TTYConfig, TTYOpen } from '../types/tty-types'

import { Zstd } from "@hpcc-js/wasm-zstd";

let DEBUG_CONFIG = false
const MSG_CHUNK_SIZE = 46 * 1024

const DEFAULT_STUN_SERVER: RTCIceServer = {
  urls: [
    'stun:stun.cloudflare.com:3478',
    'stun:stun.nextcloud.com:3478',
    'stun:stun.nextcloud.com:443',
  ]
}

function getDebug(config: Record<string, unknown>): boolean {
  return config.debug === 'true' || false
}

function isWebrtcEnabled(config: Record<string, unknown>): boolean {
  return config.webrtc === 'true' || false
}

function getMyId(config: Record<string, unknown>): string {
  return config['my-id']?.toString() || 'web'
}

function getTurnUrl(config: Record<string, unknown>): URL | null {
  const turnUrl = config['turn-url']?.toString()
  return turnUrl ? new URL(turnUrl) : null
}

function getTurnOnly(config: Record<string, unknown>): boolean {
  return config['turn-only'] ? true : false
}

type RustSession = {
  targetId: string
  relayUrl?: string
  socket?: WebSocket | RTCDataChannel
  serviceId?: string
  sessionId?: bigint
  closeReason?: string
  isOpen(): boolean
  close(notify?: (reason?: string) => void): void
  send(data: string | Uint8Array): void
  sendRaw(dataObj: object): void
}

class RustSessionImpl implements RustSession {
  targetId: string
  config: Record<string, unknown>
  relayUrl?: string
  socket?: WebSocket | RTCDataChannel
  serviceId?: string
  sessionId?: bigint
  closeReason?: string

  // datachannel
  pc?: RTCPeerConnection
  dc?: RTCDataChannel

  constructor(targetId: string, config: Record<string, unknown> = {}) {
    this.targetId = targetId
    this.config = config
  }

  getRemoteOfferFromWebrtcUrl(url: string): RTCSessionDescriptionInit | undefined {
    if (!url.startsWith('webrtc://')) {
      return undefined
    }
    const b64 = url.replace('webrtc://', '')
    const descJson = atob(b64)
    if (DEBUG_CONFIG) {
      console.log('WebRTC recv Description:', descJson)
    }
    return JSON.parse(descJson)
  }

  getWebrtcEndpoint(): string | undefined {
    if (!this.pc || !this.pc.localDescription) {
      return undefined
    }
    const localDesc = this.pc.localDescription.toJSON()
    if (DEBUG_CONFIG) {
      console.log('WebRTC send Description:', JSON.stringify(localDesc))
    }
    return `webrtc://${btoa(JSON.stringify(localDesc))}`
  }

  async initDataChannel(): Promise<void> {
    if (this.pc) {
      this.pc.close()
    }
    const iceServers: RTCIceServer[] = [DEFAULT_STUN_SERVER]
    const turnUrl = getTurnUrl(this.config)
    if (turnUrl) {
      // eslint-disable-next-line
      getTurnOnly(this.config) && iceServers.splice(0, iceServers.length)
      iceServers.push({
        urls: `turn:${turnUrl.host}`,
        username: turnUrl.username,
        credential: turnUrl.password,
      })
    }
    const pc = new RTCPeerConnection({
      iceServers: iceServers,
      iceTransportPolicy: getTurnOnly(this.config) ? "relay" : "all"
    })
    if (DEBUG_CONFIG) {
      pc.onconnectionstatechange = () => {
        console.log(`PC connection state: ${pc.connectionState}`)
      }
      pc.onicecandidate = (e) => {
        console.log(`PC ice candidate: ${e.candidate?.candidate}`)
      }
      pc.onsignalingstatechange = () => {
        console.log(`PC signaling state: ${pc.signalingState}`)
      }
    }
    this.socket = pc.createDataChannel('bootstrap')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // wait for ICE gathering to complete
    await new Promise((resolve) => {
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          resolve(null)
        }
      }
      // in case icegatheringstatechange doesn't fire
      setTimeout(resolve, 3000)
    })
    this.pc = pc
  }

  isOpen(): boolean {
    if (this.pc) {
      return this.socket?.readyState == 'open' || this.socket?.readyState == 'connecting'
    }
    return this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING
  }

  close(notify?: (reason?: string) => void): void {
    console.log(`Closing tty socket`)
    if (notify) {
      notify(this.closeReason)
    }
    this.socket?.close()
    if (this.pc) {
      this.pc.close()
      this.pc = undefined
    }
  }

  sendRaw(dataObj: object): void {
    sendSocketMsg(dataObj, this.socket)
  }

  send(data: string | Uint8Array): void {
    const dataBytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data)
    // packet size limit 48K, chunking 46K for RustDesk
    for (let i = 0; i < dataBytes.length; i += MSG_CHUNK_SIZE) {
      const chunk = dataBytes.slice(i, i + MSG_CHUNK_SIZE)
      sendSocketMsg({
        terminalAction: deskMsg.TerminalAction.create({
          union: {
            oneofKind: 'data',
            data: deskMsg.TerminalData.create({
              data: chunk
            })
          }
        })
      }, this.socket)
    }
  }

  start(relayUrl: string, uuid: string, ttyConfig: TTYConfig, openRequest: TTYOpen): void {
    let remoteOffer
    let socket
    // if relayUrl is webrtc and we have pc, use datachannel, fallback to websocket
    if (this.pc && (remoteOffer = this.getRemoteOfferFromWebrtcUrl(relayUrl))) {
      this.pc.setRemoteDescription(new RTCSessionDescription(remoteOffer))
      socket = this.socket!
    } else {
      socket = this.socket = new WebSocket(relayUrl)
      socket.binaryType = 'arraybuffer'
    }
    const myId = getMyId(ttyConfig.config!)
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
        ttyConfig.onSocketOpen?.()
        return true
      }
      if (loginResp.union.oneofKind === 'error') {
        session.closeReason = `Login failed: ${loginResp.union.error}`
      } else {
        session.closeReason = `Login failed: unknown reason`
      }
      session.close(ttyConfig.onSocketClose)
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
          session.closeReason = 'Terminal closed by server'
          session.close(ttyConfig.onSocketClose)
          break
        case 'error':
          session.closeReason = `Terminal error: ${terminalResp.union.error.message}`
          session.close(ttyConfig.onSocketClose)
          break
        default:
          console.warn(`Unhandled terminal response: ${terminalResp.union.oneofKind}`)
      }
    }

    socket.onopen = () => {
      // bind socket to relay server, on for websocket
      if (socket instanceof WebSocket) {
        sendSocketMsg({
          requestRelay: rendezvous.RequestRelay.create({ uuid })
        }, socket, true)
      }
      // login request
      sendSocketMsg({
        loginRequest: deskMsg.LoginRequest.create({
          username: this.targetId,
          myId: myId,
          myName: myId,
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
      const dataBytes = new Uint8Array(event.data)
      const msg = deskMsg.Message.fromBinary(dataBytes)

      if (DEBUG_CONFIG && msg.union.oneofKind !== 'testDelay') {
        console.log(`Recving socket message ${msg.union.oneofKind}`, msg)
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
                myId: myId,
                myName: myId,
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
            this.closeReason = msg.union.misc?.union.closeReason
            console.log(`Terminal closed: ${this.closeReason}`)
            this.close(ttyConfig.onSocketClose)
          }
          break
        default:
          console.warn(`Unhandled message type: ${msg.union.oneofKind}`)
      }
    }

    socket.onclose = () => {
      // ttyConfig.onSocketClose?.(this.closeReason)
    }

    socket.onerror = () => {
      this.closeReason = `Socket error`
      ttyConfig.onSocketClose?.(this.closeReason)
    }
  }
}

const useRustDesk = (ttyConfig: TTYConfig) => {
  const activeSession = useRef<RustSession | null>(undefined)
  const currentRequest = useRef<TTYOpen | undefined>(undefined)

  useEffect(() => {
  }, [])

  const open = async (ttyOpen: TTYOpen) => {
    DEBUG_CONFIG = getDebug(ttyConfig.config)
    const targetId = ttyOpen.targetId
    if (!targetId) {
      throw new Error('No target ID provided')
    }
    if (currentRequest.current) {
      return
    }
    currentRequest.current = ttyOpen

    if (activeSession.current?.isOpen()) {
      activeSession.current.close()
      console.warn(`TTY socket on, close existing socket`)
    }
    const session = activeSession.current = new RustSessionImpl(targetId, ttyConfig.config)
    if (isWebrtcEnabled(ttyConfig.config)) {
      await session.initDataChannel()
    }
    if (DEBUG_CONFIG) {
      (globalThis as unknown as { terminal: RustSessionImpl }).terminal = session
    }

    try {
      const punchResponse = await sendRendezvousRequest(ttyConfig.url, {
        punchHoleRequest: rendezvous.PunchHoleRequest.create({
          id: targetId,
          natType: rendezvous.NatType.SYMMETRIC,
          connType: rendezvous.ConnType.TERMINAL,
          version: session.getWebrtcEndpoint() || '1.4.4',
        })
      })
      const msg = punchResponse as rendezvous.RendezvousMessage

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
        const version = msg.union.relayResponse!.version
        if (version && version.startsWith('webrtc://')) {
          // use datachannel
          session.start(version, msg.union.relayResponse!.uuid, ttyConfig, ttyOpen)
          return
        }
        const relayServer = msg.union.relayResponse!.relayServer
        if (!relayServer) {
          throw new Error('No relay server provided')
        }
        session.start(relayServer, msg.union.relayResponse!.uuid, ttyConfig, ttyOpen)
      }
    } finally {
      currentRequest.current = undefined
    }
  }

  const send = (data: string | Uint8Array) => {
    activeSession.current?.send(data)
  }

  const close = () => {
    activeSession.current?.close()
  }

  const sendRaw = (dataObj: object) => {
    activeSession.current?.sendRaw(dataObj)
  }

  return { open, close, send, sendRaw }
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
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => {
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
      const dataBytes = new Uint8Array(event.data)
      const msg = rendezvous.RendezvousMessage.fromBinary(dataBytes)
      console.log(`Recving response ${msg.union.oneofKind}`, msg)
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

const sendSocketMsg = (data: object, socket?: WebSocket | RTCDataChannel, isRendezvous: boolean = false) => {
  if (!socket) {
    return
  }
  const type = Object.keys(data)[0]
  if (DEBUG_CONFIG && type !== 'testDelay') {
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
  // Ensure the buffer is an ArrayBuffer, not SharedArrayBuffer
  const arrayBuffer = binaryMessage.buffer instanceof ArrayBuffer
    ? binaryMessage.buffer
    : new Uint8Array(binaryMessage).buffer
  socket.send(new Uint8Array(arrayBuffer))
}

export default useRustDesk