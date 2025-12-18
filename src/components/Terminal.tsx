'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ImageAddon } from '@xterm/addon-image'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'

import { OverlayAddon } from './addons/overlay'
import { ZmodemAddon } from './addons/zmodem'
import { LocalCliAddon } from './addons/local-cli'
import { ScreenShareAddon } from './addons/screen-share'
import useTTYD from '../hooks/use-ttyd'
import useRustDesk from '../hooks/use-rustdesk'
import useSupabaseChannel from '../hooks/use-supabase'
import { ChromeTTS } from '../lib/tts'

import type { TTYConfig, TTY, FnSetUrl, TTYChannel } from '../types/tty-types'

const TEXT_DECODER = new TextDecoder()
const CONFIG_KEYS = [
  'debug', // boolean enable message debug logging
  'url', // string backend url
  'name', // string my rustdesk id, display on remote side
  'webrtc', // boolean enable webrtc
  'cname', // boolean get cname of server host
  'turn-url', // string turn server url, turn://user:pass@host:port
  'turn-only', // boolean use only turn server
  'trzsz', // boolean enable trzsz file transfer, trs tsz cmd
  'zmodem', // boolean enable zmodem file transfer, kinda experimental
  'bark-url', // string bark notification url
  'channel-room', // string channel room
  'confirm-to-unload' // boolean enable confirm dialog on page unload
]

function TerminalInner({ wsUrl, setWsUrl }: { wsUrl: string, setWsUrl: FnSetUrl }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const zmodemRef = useRef<ZmodemAddon | null>(null)
  const ssRef = useRef<ScreenShareAddon | null>(null)
  const cliRef = useRef<LocalCliAddon | null>(null)

  const ttyConnected = useRef<boolean>(false)
  const ttyType: string = getBackendType(wsUrl)

  const ttsPlayer = useMemo(() => new ChromeTTS(), [])
  const sbChannel: TTYChannel = useSupabaseChannel({
    roomName: getLocalConfig('channel-room') || 'public',
    selfName: getLocalConfig('name') || 'web-' + Math.floor(Math.random() * 1000),
    onChannelOpen: () => {
      termRef.current?.writeln(`\n\x1b[32mConnected to ${getLocalConfig('channel-room')}.\x1b[0m\n`)
      cliRef.current?.writePrompt()
    },
    onChatMessage: (msg) => {
      if (ChromeTTS.isSupported()) {
        ttsPlayer.speak(msg.content as string)
      }
      console.log(`${msg.sender}: ${msg.content}`)
    }
  })

  const innerRef = {
    setWsUrl,
    channel: sbChannel,
    ttyConnected: ttyConnected,
    termRef: termRef,
    ssRef: ssRef,
    cliRef: cliRef,
    zmodemRef: zmodemRef,
  }

  const ttyConfig: TTYConfig = {
    url: wsUrl,
    config: localStorage,
    onSocketData: (data: Uint8Array) => {
      if (zmodemRef.current)
        zmodemRef.current.consume(data)
      else {
        termRef.current?.write(TEXT_DECODER.decode(data))
      }
      if (ssRef.current) {
        ssRef.current.handleTermOutput(data)
      }
    },
    onSocketOpen: () => {
      ttyConnected.current = true
      termRef.current!.options.disableStdin = false
    },
    onSocketClose(reason?: string) {
      ttyConnected.current = false
      termRef.current!.options.disableStdin = false
      termRef.current?.writeln(`\n\x1b[31mConnection closed. ${reason}\x1b[0m\n`)
      cliRef.current?.writePrompt()
    },
    onAuthRequired: async (prompt?: string) => handleSecretInput(termRef.current!, prompt)
  }

  // eslint-disable-next-line
  const tty: TTY = ttyType == 'rustdesk' ? useRustDesk(ttyConfig) : useTTYD(ttyConfig)

  useEffect(() => {
    console.log('TerminalInner mounted with wsUrl:', wsUrl)
    if (!containerRef.current) return

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: true,
      fontSize: 14,
      lineHeight: 1.4,
      fontFamily: 'Lucida Console, "Courier New", monospace',
      theme: {
        background: '#0b1220', // dark navy
        foreground: '#e6eef8', // light text
        cursor: '#ffffff'
      }
    })
    termRef.current = term

    cliRef.current = loadLocalCli(term, tty, innerRef)
    loadScreenShare(term, ssRef)
    loadAddons(term)

    term.onData((data: string) => {
      if (ttyConnected.current) {
        tty.send(data)
        cliRef.current?.handleConnectedInput(data)
      } else {
        cliRef.current?.handleTermInput(data)
      }
    })

    // open the terminal
    term.open(containerRef.current!)
    // auto focus
    term.focus()
    // load zmodem addon after terminal is opened
    zmodemRef.current = loadZmodemAddon(term, tty.send)
    // resize observer
    const { ro, resize } = registerResizeObserver(term, containerRef.current!)

    helloMessage(term)

    return () => {
      tty.close()
      unregisterResizeObserver(ro, resize)
      term.dispose()
      console.log('TerminalInner unmounted with wsUrl:', wsUrl)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className='h-screen bg-gray-900' />
}

function registerResizeObserver(term: Terminal, container: HTMLDivElement) {
  const fitAddon = new FitAddon()
  const resize = () => {
    try { fitAddon.fit() } catch { /* ignore */ }
  }
  term.loadAddon(fitAddon)
  const ro = new ResizeObserver(() => {
    resize()
  })
  ro.observe(container)
  window.addEventListener('resize', resize)
  return { ro, resize }
}

function unregisterResizeObserver(ro: ResizeObserver, onWindowResize: () => void) {
  ro.disconnect()
  window.removeEventListener('resize', onWindowResize)
}

function loadAddons(term: Terminal) {
  // Activate the WebGL addon
  try {
    term.loadAddon(new WebglAddon())
  } catch (e) {
    console.warn('load webgl error:', e)
  }
  term.loadAddon(new ClipboardAddon())
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(new ImageAddon())
  term.loadAddon(new Unicode11Addon())
  const overlay = new OverlayAddon()
  term.loadAddon(overlay)
  term.onSelectionChange(() => {
    if (term.getSelection() === '') return;
    try {
      document.execCommand('copy');
      overlay.showOverlay('\u2702', 300);
    } catch { /* ignore */ }
  })
}

function loadLocalCli(term: Terminal, tty: TTY, innerRef: unknown): LocalCliAddon {
  const localCli = new LocalCliAddon()
  term.loadAddon(localCli)

  localCli.registerCommandHandler(['help', 'h'], async () => helpMessage(term))
  localCli.registerCommandHandler(['reload', 'r'], async () => window.location.reload())
  localCli.registerCommandHandler(['connect', 'c'], async (args) => {
    term.writeln(`Connecting to ${getDefaultUrl()}, with webrtc: ${getLocalConfig('webrtc')}`)
    term.writeln('')
    tty.open({ cols: term.cols, rows: term.rows, targetId: args[0] })
  })

  localCli.registerCommandHandler(['config'], async (args) => {
    const [key, value] = await handleConfigCommand(term, args)
    // eslint-disable-next-line
    key === 'url' && (innerRef as { setWsUrl: FnSetUrl }).setWsUrl(value)
  })

  localCli.registerCommandHandler(['clear'], async () => {
    const ttyConnected = (innerRef as { ttyConnected: { current: boolean } }).ttyConnected.current
    if (!ttyConnected) {
      term.clear()
    }
  })

  localCli.registerCommandHandler(['nslookup', 'dig'], async (args) => {
    const encodedHost = encodeURIComponent(args[0])
    const res = await fetch(`/api/resolve?name=${encodedHost}`)
    const data = await res.json()
    if (!data['Answer']) {
      term.writeln(`No answer for: ${args[0]}\n`)
    } else {
      term.writeln(JSON.stringify(data['Answer'], null, 2).replace(/\n/g, '\r\n'))
    }
  })

  localCli.registerCommandHandler(['curl'], async (args) => {
    // simple curl implementation using fetch, done by backend to avoid CORS issue
    // TODO support more options, ws, wss
    const res = await fetch(`/api/curl?url=${encodeURIComponent(args[args.length - 1])}`)
    term.writeln(`HTTP/${res.status} ${res.statusText}\n`)
    if (res.type.startsWith('application/json')) {
      const data = await res.json()
      term.writeln(JSON.stringify(data, null, 2).replace(/\n/g, '\r\n'))
    } else {
      const data = await res.text()
      if (!data) {
        term.writeln('\n')
        return
      }
      term.writeln(data.replace(/\n/g, '\r\n'))
    }
  })

  localCli.registerCommandHandler(['bark'], async (args) => {
    // send bark notification via backend
    const barkUrl = getLocalConfig('bark-url')
    if (!barkUrl) {
      term.writeln('Bark URL not set. Use "config bark-url <url>" to set it.\n')
      return
    }
    if (!args[0]) {
      term.writeln(`Bark URL is ${barkUrl}\n`)
      return
    }
    const res = await fetch(`/api/curl?url=${encodeURIComponent(barkUrl + args.join(' '))}`)
    term.writeln(`HTTP/${res.status} ${res.statusText} ${args.join(' ')}\n`)
  })

  localCli.registerCommandHandler(['ls'], async (_args) => {
    const channel = (innerRef as { channel: TTYChannel }).channel
    term.writeln(`Online members (${getLocalConfig('channel-room')}):\n`)
    channel.onlineMembers().forEach((member) => {
      const isSelf = channel.presenceId() === member.id
      term.writeln(`${isSelf ? '*' : '-'} ${member.name} (${member.id})`)
    })
    term.writeln('')
  })

  localCli.registerCommandHandler(['chat'], async (args) => {
    await (innerRef as { channel: TTYChannel }).channel.sendMessage(args.join(' '))
    term.writeln('')
  })

  localCli.registerCommandHandler(['ssh'], async (_args) => {
    // TODO add web ssh with wasm
  })

  localCli.registerCommandHandler(['ssc'], async (args) => {
    const ttyConnected = (innerRef as { ttyConnected: { current: boolean } }).ttyConnected.current
    if (!ttyConnected) {
      term.writeln('Not connected to tty, cannot start screen share session.')
      return
    }
    const ssRef = (innerRef as { ssRef: { current: ScreenShareAddon | null } }).ssRef.current
    const cmd = await ssRef?.requestDataChannel(args)
    tty.send(`${cmd}\r`)
  })

  return localCli
}

function loadScreenShare(term: Terminal, ref: React.RefObject<ScreenShareAddon | null>) {
  if (ref.current) {
    ref.current.dispose()
  }
  ref.current = new ScreenShareAddon()
  term.loadAddon(ref.current)
}

function loadZmodemAddon(term: Terminal, send: (data: string | Uint8Array) => void): ZmodemAddon {
  const zmodemEnabled = getLocalConfig('zmodem') === 'true'
  const trzszEnabled = getLocalConfig('trzsz') === 'true'
  if (!zmodemEnabled && !trzszEnabled) {
    return null as unknown as ZmodemAddon
  }
  // Zmodem addon
  const zmodemAddon = new ZmodemAddon({
    trzsz: trzszEnabled,
    zmodem: zmodemEnabled,
    sender: (data: string | Uint8Array) => {
      send(data)
    },
    writer: (data: string | Uint8Array) => {
      term.write(data)
    },
    onSend: () => {
      term.writeln('\nStarting file sending...\n')
    }
  })
  term.loadAddon(zmodemAddon)
  return zmodemAddon
}

const getBackendType = (url: string) => {
  return url.startsWith('ttyd://') || url.startsWith('ttyds://') ? 'ttyd' : 'rustdesk'
}

const getDefaultUrl = () => {
  return localStorage.getItem('url') || '/ws/id'
}

const getLocalConfig = (key: string): string | null => {
  return localStorage.getItem(key)
}

const delLocalConfig = (key: string) => {
  localStorage.removeItem(key)
  console.log(`Config deleted: ${key}`)
}

const setLocalConfig = (key: string, value: string): boolean => {
  // TODO chceck valid url
  localStorage.setItem(key, value)
  console.log(`Config set: ${key} = ${value}`)
  return true
}

const helloMessage = (term: Terminal) => {
  term.writeln('Welcome to the RustDesk terminal!')
  term.writeln('Type "help" or "h" for available commands.')
  term.writeln('')
}

const helpMessage = (term: Terminal) => {
  term.writeln('\nAvailable commands:')
  term.writeln('  (c) connect <id>       - Connect to the server.')
  term.writeln('      config             - Show current settings.')
  term.writeln('      config url <v>     - Set backend URL.')
  term.writeln('      config webrtc true - Enable webrtc.')
  term.writeln('      config debug true  - Enable debug.')
  term.writeln('  (r) reload             - Reload the terminal.')
  term.writeln('  (h) help               - Show this help message.')
  term.writeln('      clear              - Clear the terminal screen.')
  term.writeln('')
}

const handleSecretInput = (term: Terminal, prompt?: string): Promise<string> => {
  // prompt the user for a password
  term.writeln(prompt || 'Authentication required. input password:')
  term.options.disableStdin = true
  return new Promise<string>((resolve) => {
    let secret = ''
    let listener: IDisposable | undefined = undefined
    listener = term.onKey((ev) => {
      if (ev.key === '\r') {
        listener?.dispose()
        resolve(secret)
        setTimeout(() => {
          term.options.disableStdin = false
        })
      } else if (ev.key === '\u007f') { // Backspace
        if (secret.length > 0) {
          secret = secret.slice(0, -1)
        }
      } else if (ev.key.length === 1) {
        secret += ev.key
      }
    })
  })
}

const handleConfigCommand = async (term: Terminal, args: string[]) => {
  if (args.length == 0) {
    for (const key of CONFIG_KEYS) {
      const value = getLocalConfig(key)
      if (value) {
        term.writeln(`${key}: ${value}`)
      } else {
        term.writeln(`${key}: (not set)`)
      }
    }
    term.writeln('')
    return Promise.reject()
  }

  const key = args[0]
  if (args.length < 2) {
    if (CONFIG_KEYS.includes(key)) {
      delLocalConfig(key)
      term.writeln(`config ${key} cleared.`)
      term.writeln('')
      return Promise.reject()
    }
    term.writeln('Usage: config <key> <value>')
    term.writeln('Example:')
    term.writeln('  config url wss://hbbs.url/ws/id')
    term.writeln('  config url ttyd://ttyd.url')
    term.writeln('')
    return Promise.reject()
  }

  if (!CONFIG_KEYS.includes(key)) {
    term.writeln(`Unknown config key: ${key}`)
    term.writeln(`Supported config keys: ${CONFIG_KEYS.join(', ')}`)
    term.writeln('')
    return Promise.reject()
  }

  const value = args[1]
  if (setLocalConfig(key, value)) {
    term.writeln(`${key} set to: ${value}`)
    term.writeln('')
    return Promise.resolve([key, value])
  }

  term.writeln('')
  return Promise.reject()
}

export default function TerminalComponent() {
  const [wsUrl, setWsUrl] = useState(getDefaultUrl())

  useEffect(() => {
    if (getLocalConfig('confirm-to-unload') !== 'true') {
      return
    }
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // Use a key to force remount of TerminalInner when wsUrl changes
  // This correctly handles re-initialization of hooks and terminal state.
  return <TerminalInner key={wsUrl} wsUrl={wsUrl} setWsUrl={setWsUrl} />
}
