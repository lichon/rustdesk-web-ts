import { useEffect } from 'react'
import * as rendezvous from './hbbs-rendezvous'

function sendRendezvous(data: unknown, socket: WebSocket | undefined) {
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

const useRustDesk = (url: string, protocols?: string | string[]) => {

  useEffect(() => {
  }, [])

  const requestTerminal = async (targetId: string, timeoutMs: number = 30000) => {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, protocols)
      socket.onopen = () => {
        sendRendezvous({
          punchHoleRequest: rendezvous.PunchHoleRequest.create({
            id: targetId,
            connType: rendezvous.ConnType.TERMINAL,
          })
        }, socket)
      }
      socket.onmessage = async (event: MessageEvent) => {
        const dataBytes = await event.data.arrayBuffer()
        const msg = rendezvous.RendezvousMessage.fromBinary(new Uint8Array(dataBytes))
        if (msg.union.oneofKind || '' in ['relayResponse', 'punchHoleResponse']) {
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

  return { requestTerminal }
}

export default useRustDesk