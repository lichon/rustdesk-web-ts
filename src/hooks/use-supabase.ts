import { createClient } from '@supabase/supabase-js'
import type { TTYChannel } from '../types/tty-types'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_KEY!,
)

type ChannelMessageType = 'message' | 'event' | 'command'

type ChannelRequestMethod = 'ping' | 'connect'

export interface ChannelCommand {
  tid?: string
  method?: ChannelRequestMethod
  body?: unknown
  error?: string
}

export interface ChannelMessage {
  id?: string // message sender id
  type?: ChannelMessageType
  content: unknown
  timestamp?: string
  sender?: string
}

interface ChannelMember {
  id: string
  name: string
  image: string
}

interface ChannelConfig {
  roomName: string
  selfName?: string
  onChannelOpen?: () => void
  onChannelEvent?: (msg: ChannelMessage) => void
  onChannelRequest?: (req: ChannelCommand) => Promise<unknown>
  onChatMessage?: (msg: ChannelMessage) => void
}

let activeChannel: TTYChannel | null = null
const myId = crypto.randomUUID()
// cache of outgoing requests' resolvers
const outgoingRequests = new Map<string, { resolve: (data: unknown) => void, reject: (err: Error) => void }>()

export default function useSupabaseChannel(config: ChannelConfig) {
  if (activeChannel) {
    return activeChannel
  }
  let initConnected: boolean = false
  const onlineMembersRef = { current: [] as ChannelMember[] }

  const channel = supabase.channel(`room:${config.roomName}:messages`, {
    config: {
      broadcast: { self: false },
      presence: { key: myId },
      private: false,
    }
  }).on('broadcast', { event: 'message' }, (msg) => {
    config.onChatMessage?.(msg.payload as ChannelMessage)
  }).on('broadcast', { event: 'event' }, (msg) => {
    config.onChannelEvent?.(msg.payload as ChannelMessage)
  }).on('broadcast', { event: 'command' }, (msg) => {
    channelCommandHandler(msg.payload as ChannelMessage, channel)
  }).on('presence', { event: 'sync' }, () => {
    const newState = channel.presenceState<ChannelMember>()
    onlineMembersRef.current = Array.from(
      Object.entries(newState).map(([key, values]) => [
        { id: key, name: values[0].name, image: values[0].image }
      ][0])
    )
  }).on('presence', { event: 'join' }, (e) => {
    e.newPresences.map(p => {
      console.log(`${p.name} joined`)
    })
  }).on('presence', { event: 'leave' }, (e) => {
    e.leftPresences.map(p => {
      console.log(`${p.name} left`)
    })
  }).subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') {
      if (status === 'CHANNEL_ERROR') {
        setTimeout(() => {
          channel.subscribe();
        }, Math.floor(Math.random() * (4000)) + 1000)
      }
      return
    }
    if (!initConnected) {
      initConnected = true
      config.onChannelOpen?.()
    }
    await channel.track({
      id: myId,
      name: config.selfName,
      image: `https://api.dicebear.com/7.x/thumbs/svg?seed=${myId}`
    })
  })

  const newMessage = function (content: string | object): ChannelMessage {
    const message: ChannelMessage = {
      id: myId,
      content: content,
      sender: config.selfName,
      timestamp: new Date().toISOString(),
    }
    return message
  }

  const channelCommandHandler = async (cmd: ChannelMessage, ch: typeof channel) => {
    const req = cmd.content as ChannelCommand
    if (myId === cmd.id) {
      // ignore commands from self
      return
    }
    if (!req.method?.length) {
      const res = cmd.content as ChannelCommand
      const handlers = outgoingRequests.get(res.tid!)
      if (!handlers) {
        return
      }
      console.log('recvChannelResponse', cmd.content)
      if (res.error) {
        handlers.reject(new Error(res.error))
      } else {
        handlers.resolve(res.body)
      }
      return
    }

    switch (req.method) {
      case 'ping':
        sendChannelCommand({ tid: req.tid, body: 'pong' }, ch)
        break
      default:
        try {
          const res = await config.onChannelRequest?.(req)
          if (!res)
            return
          console.log('handleChannelRequest', req)
          sendChannelCommand({ tid: req.tid, body: res }, ch)
        } catch (e) {
          const error = e instanceof Error ? e.message : 'unknown error'
          sendChannelCommand({ tid: req.tid, error }, ch)
        }
        break
    }
  }

  const sendChannelCommand = async (cmd: ChannelCommand, ch: typeof channel) => {
    console.log(`${cmd.method ? 'sendChannelRequest' : 'sendChannelResponse'}`, cmd)
    await ch?.send({
      type: 'broadcast',
      event: 'command',
      payload: newMessage(cmd),
    })
  }

  const sendRequest = async (req: ChannelCommand): Promise<ChannelCommand> => {
    if (!req.tid?.length) {
      req.tid = crypto.randomUUID()
    }
    const tid = req.tid

    if (!isConnected()) {
      return { error: 'channel not connected' } as ChannelCommand
    }

    let timeoutId: NodeJS.Timeout
    const response = new Promise((resolve, reject) => {
      outgoingRequests.set(tid, { resolve, reject })
      timeoutId = setTimeout(() => {
        reject(new Error('timeout'))
      }, 10000)
    })

    await sendChannelCommand(req, channel)

    try {
      const data = await response
      clearTimeout(timeoutId!)
      return { body: data } as ChannelCommand
    } catch (e) {
      const error = e instanceof Error ? e.message : 'unknown error'
      return { error } as ChannelCommand
    } finally {
      console.log('ChannelRequest done', tid)
      outgoingRequests.delete(tid)
    }
  }

  const sendMessage = async (content: string | object, type?: ChannelMessageType) => {
    await channel?.send({
      type: 'broadcast',
      event: type || 'message',
      payload: newMessage(content),
    })
  }

  const isConnected = (): boolean => {
    return channel.state == 'joined'
  }

  const presenceId = (): string => {
    return myId
  }

  const onlineMembers = (): ChannelMember[] => {
    return onlineMembersRef.current
  }

  const close = () => {
    channel.unsubscribe()
    activeChannel = null
  }

  return activeChannel = {
    close,
    sendMessage,
    sendRequest,
    presenceId,
    isConnected,
    onlineMembers
  }
}
