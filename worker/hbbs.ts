import { DurableObject } from 'cloudflare:workers'
import * as rendezvous from './hbbs-rendezvous'
// import * as deskMsg from './hbbs-message'

export class Hbbr extends DurableObject {
  // In-memory state
  initiator: WebSocket | undefined
  acceptor: WebSocket | undefined
  cachedMessagesFromInit: Array<string | ArrayBuffer> = []
  cachedMessagesFromAcceptor: Array<string | ArrayBuffer> = []

  async warmup(): Promise<void> {
    console.log(`Hbbr warmup called`)
  }

  async fetch(_req: Request): Promise<Response> {
    // console.log(`hbbr fetch ${req.url}`)
    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)
    this.ctx.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (this.initiator === socket) {
      // const msg = deskMsg.Message.fromBinary(new Uint8Array(message as ArrayBuffer))
      // if (msg.union?.oneofKind !== 'testDelay') {
      //   console.log(`message from initiator: ${msg.union?.oneofKind}`, msg.union)
      // }
      // message from initiator, forward to acceptor
      if (this.acceptor && this.acceptor.readyState === 1) {
        this.acceptor.send(message)
      } else {
        // cache the message until accaptor is ready
        this.cachedMessagesFromInit.push(message)
      }
      return
    }
    if (this.acceptor === socket) {
      // const msg = deskMsg.Message.fromBinary(new Uint8Array(message as ArrayBuffer))
      // if (msg.union?.oneofKind !== 'testDelay') {
      //   console.log(`message from acceptor: ${msg.union?.oneofKind}`, msg.union)
      // }
      // message from acceptor, forward to initiator
      if (this.initiator && this.initiator.readyState === 1) {
        this.initiator.send(message)
      } else {
        // cache the message until initiator is ready
        this.cachedMessagesFromAcceptor.push(message)
      }
      return
    }

    // new connection message
    if (message instanceof ArrayBuffer) {
      const msg = rendezvous.RendezvousMessage.fromBinary(new Uint8Array(message))
      // console.log(`rendezvous relay received ${message.byteLength}`, msg)
      switch (msg.union?.oneofKind) {
        case 'requestRelay':
          this.handleRequestRelay(msg.union.requestRelay, socket)
          break
        default:
          console.log(`unsupported relay msg type: ${msg.union?.oneofKind}`)
      }
    } else {
      socket.close()
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean) {
    if (ws === this.initiator) {
      this.initiator = undefined
      console.log(`hbbr initiator closed`)
      this.acceptor?.close(code, "peer closed")
    }
    if (ws === this.acceptor) {
      this.acceptor = undefined
      console.log(`hbbr accaptor closed`)
      this.initiator?.close(code, "peer closed")
    }
  }

  handleRequestRelay(req: rendezvous.RequestRelay, socket: WebSocket) {
    if (!this.initiator) {
      this.initiator = socket
      console.log(`setup initiator for uuid: ${req.uuid} cached msg: ${this.cachedMessagesFromAcceptor.length}`)
      if (this.cachedMessagesFromAcceptor.length > 0) {
        // send cached messages to accaptor
        for (const msg of this.cachedMessagesFromAcceptor) {
          this.initiator.send(msg)
        }
        this.cachedMessagesFromAcceptor = []
      }
      return
    }
    if (this.initiator === socket) {
      return
    }
    if (!this.acceptor) {
      this.acceptor = socket
      console.log(`setup accaptor for uuid: ${req.uuid} cached msg: ${this.cachedMessagesFromInit.length}`)
      if (this.cachedMessagesFromInit.length > 0) {
        // send cached messages to accaptor
        for (const msg of this.cachedMessagesFromInit) {
          this.acceptor.send(msg)
        }
        this.cachedMessagesFromInit = []
      }
    }
  }
}

export class Hbbs extends DurableObject {
  // In-memory state
  sessions: Map<string, {
    ip: string,
    id: string,
    uuid: string,
    socket: WebSocket,
  }> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // We will track metadata for each client WebSocket object in `sessions`.
    this.sessions = new Map()
    ctx.getWebSockets().forEach((webSocket) => {
      // The constructor may have been called when waking up from hibernation,
      // so get previously serialized metadata for any existing WebSockets.
      const meta = webSocket.deserializeAttachment()
      if (!meta) {
        // console.log('hbbr no meta on websocket', webSocket)
        return
      }
      meta.socket = webSocket

      // We don't send any messages to the client until it has sent us the initial user info
      // message. Until then, we will queue messages in `session.blockedMessages`.
      // This could have been arbitrarily large, so we won't put it in the attachment.
      this.sessions.set(meta.id, meta)
    })
  }

  async fetch(req: Request): Promise<Response> {
    // console.log(`hbbs fetch ${req.url}`)
    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)

    // Calling `acceptWebSocket()` connects the WebSocket to the Durable Object, allowing the WebSocket to send and receive messages.
    // Unlike `ws.accept()`, `state.acceptWebSocket(ws)` allows the Durable Object to be hibernated
    // When the Durable Object receives a message during Hibernation, it will run the `constructor` to be re-initialized
    this.ctx.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  // receiving a message from the client
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message instanceof ArrayBuffer) {
      const msg = rendezvous.RendezvousMessage.fromBinary(new Uint8Array(message))
      // const meta = ws.deserializeAttachment()
      // console.log(`rendezvous received ${message.byteLength} from ${meta?.id}`, msg)
      switch (msg.union?.oneofKind) {
        case 'registerPk':
          this.handleRegisterPk(msg.union.registerPk, ws)
          break
        case 'onlineRequest':
          this.handleOnlineRequest(msg.union.onlineRequest, ws)
          break
        case 'punchHoleRequest':
          this.handlePunchHoleRequest(msg.union.punchHoleRequest, ws)
          break
        case 'relayResponse':
          this.handleRelayResponse(msg.union.relayResponse, ws)
          break
        default:
          console.log(`unsupported msg type: ${msg.union?.oneofKind}`)
      }
      return
    }
    // close the connection for unsupported message type
    ws.close()
  }

  // client closes the connection, the runtime will invoke the webSocketClose() handler.
  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean) {
    ws.deserializeAttachment()
    const meta = ws.deserializeAttachment()
    if (meta) {
      this.sessions.delete(meta.id)
      console.log(`rendezvous client closed id: ${meta.id} uuid: ${meta.uuid}`)
    }
    // ws.close(code, "client closed")
  }

  sendRendezvous(data: unknown, socket: WebSocket | undefined) {
    if (!data) {
      return
    }
    if (!socket || socket.readyState != 1) {
      console.log('sendRendezvous socket not open')
      return
    }
    const type = Object.keys(data)[0]
    const msg = {
      union: {
        oneofKind: type,
        ...data
      }
    } as rendezvous.RendezvousMessage
    // const meta = socket.deserializeAttachment()
    // console.log(`Sending rendezvous to ${meta?.id}:`, msg)
    socket.send(rendezvous.RendezvousMessage.toBinary(msg))
  }

  handleRelayResponse(res: rendezvous.RelayResponse, _socket: WebSocket) {
    console.log(`Handling relay response: ${res.version}`)
  }

  handlePunchHoleRequest(req: rendezvous.PunchHoleRequest, socket: WebSocket) {
    const targetId = req?.id
    console.log(`Handling punch hole request to id: ${targetId}`)
    if (!targetId) {
      this.sendRendezvous({
        punchHoleResponse: rendezvous.PunchHoleResponse.create({
          otherFailure: 'invalid request'
        })
      }, socket)
      return
    }
    const onlineSession = this.sessions.get(targetId)
    if (!onlineSession) {
      this.sendRendezvous({
        punchHoleResponse: rendezvous.PunchHoleResponse.create({
          failure: 0,
          otherFailure: 'target not online'
        })
      }, socket)
      return
    }
    // generate random 128 bit for socket address
    // fix issue with rustdesk skip duplicate relay request messages from 0.0.0.0:0
    const random64 = crypto.getRandomValues(new Uint8Array(8))
    const random64Next = crypto.getRandomValues(new Uint8Array(8))
    const last32bit = new Uint8Array(4).fill(0)
    const random128bit = new Uint8Array(16)
    random128bit.set(random64, 0)
    random128bit.set(random64Next, 8)
    random128bit.set(last32bit, 12)

    const relayUrl = (this.env as { HBBS_RELAY_URL?: string }).HBBS_RELAY_URL || 'ws://localhost'
    // const uuid = crypto.randomUUID()
    // pre-warm DO, make sure both side connect to the same region's DO, reduce connection time
    const hbbrObjId = this.env.HBBR.newUniqueId()
    this.env.HBBR.get(hbbrObjId).warmup()
    const uuid = hbbrObjId.toString()

    this.sendRendezvous({
      requestRelay: rendezvous.RequestRelay.create({
        socketAddr: random128bit,
        id: targetId,
        uuid: uuid,
        relayServer: `${relayUrl}/ws/relay/${uuid}`,
      })
    }, onlineSession.socket)
    this.sendRendezvous({
      relayResponse: rendezvous.RelayResponse.create({
        uuid: uuid,
        relayServer: `${relayUrl}/ws/relay/${uuid}`,
        version: '1.4.3',
      })
    }, socket)
  }

  handleRegisterPk(req: rendezvous.RegisterPk, socket: WebSocket) {
    const peerId = req?.id
    const peerUuid = new TextDecoder().decode(req?.uuid)
    console.log(`Handling register pk id: ${peerId} uuid: ${peerUuid}`)
    if (!peerId) {
      socket.close()
      return
    }
    const meta = socket.deserializeAttachment()
    socket.serializeAttachment({
      ip: meta?.ip || '',
      id: peerId,
      uuid: peerUuid,
    })
    this.sessions.set(peerId, {
      ip: meta?.ip || '',
      id: peerId,
      uuid: peerUuid,
      socket: socket
    })
    this.sendRendezvous({
      registerPkResponse: rendezvous.RegisterPkResponse.create({
        result: 0,
        keepAlive: 180,
      })
    }, socket)
  }

  handleOnlineRequest(req: rendezvous.OnlineRequest, socket: WebSocket) {
    const peerId = req?.id
    console.log(`Handling online request id: ${peerId} peers: ${req?.peers}`)
    if (!peerId) {
      return
    }
    const states = new Uint8Array(Math.ceil(req.peers.length / 8))
    for (let i = 0; i < req.peers.length; i++) {
      const online = this.sessions.has(req.peers[i])
      if (online) {
        states[i / 8] |= (0x01 << (7 - i % 8))
      }
    }
    this.sendRendezvous({
      onlineResponse: rendezvous.OnlineResponse.create({
        states
      })
    }, socket)
  }

}
