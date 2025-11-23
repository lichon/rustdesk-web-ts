import { useEffect, useRef, useState } from 'react'
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
import useTTYD from '../hooks/use-ttyd'
import useRustDesk from '../hooks/use-rustdesk'
import type { TTYConfig } from '../types/tty-types'

const { VITE_DEFAULT_TTY_URL } = import.meta.env
const TEXT_DECODER = new TextDecoder()
const CONFIG_KEYS = [
  'debug', // boolean enable message debug logging
  'url', // string backend url
  'my-id', // string my rustdesk id, display on remote side
  'webrtc', // boolean enable webrtc
  'turn-url', // string turn server url, turn://user:pass@host:port
  'turn-only', // boolean use only turn server
  'trzsz', // boolean enable trzsz file transfer, trs tsz cmd
  'zmodem' // boolean enable zmodem file transfer, kinda experimental
]

function TerminalInner({ wsUrl, setWsUrl }: { wsUrl: string, setWsUrl: (url: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const zmodemRef = useRef<ZmodemAddon | null>(null)
  const ttyConnected = useRef<boolean>(false)
  const isRustDesk = !isTTYdUrl(wsUrl)

  const ttyConfig: TTYConfig = {
    url: wsUrl,
    config: localStorage,
    onSocketData: (data: Uint8Array) => {
      if (zmodemRef.current)
        zmodemRef.current.consume(data.slice(0).buffer)
      else {
        termRef.current?.write(TEXT_DECODER.decode(data))
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
      termRef.current?.write('> ')
    },
    onAuthRequired: async () => handleSecretInput(termRef.current!)
  }

  const {
    open: openSocket,
    close: closeSocket,
    send: sendUserInput,
    // eslint-disable-next-line react-hooks/rules-of-hooks
  } = isRustDesk ? useRustDesk(ttyConfig) : useTTYD(ttyConfig)

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

    const localCli = new LocalCliAddon()
    term.loadAddon(localCli)
    localCli.registerCommandHandler(['help', 'h'], () => helpMessage(term))
    localCli.registerCommandHandler(['reload', 'r'], () => window.location.reload())
    localCli.registerCommandHandler(['connect', 'c'], (args) => {
      const targetId = args[0]
      if (!targetId) {
        term.writeln('Usage: connect <targetId>')
        return
      }
      term.writeln(`Connecting to ${wsUrl}..., enable webrtc: ${getLocalConfig('webrtc')}`)
      openSocket({
        cols: term.cols,
        rows: term.rows,
        targetId
      }).catch((err) => {
        term.writeln(`\n\x1b[31mError: ${err.message}\x1b[0m\n`)
        term.write('> ')
      })
    })
    localCli.registerCommandHandler(['config'], (args) => {
      handleConfigCommand(term, args).then(([key, value]) => {
        key === 'url' && setWsUrl(value) // eslint-disable-line
      }).catch(() => { /* ignore */ })
    })
    localCli.registerCommandHandler(['clear'], () => {
      term.clear()
      term.write('> ')
    })

    term.onData((data: string) => {
      if (ttyConnected.current) {
        sendUserInput(data)
      } else {
        localCli.handleTermInput(data)
      }
    })

    loadAddons(term)
    // open the terminal
    term.open(containerRef.current!)
    // auto focus
    term.focus()
    // load zmodem addon after terminal is opened
    zmodemRef.current = loadZmodemAddon(term, sendUserInput)
    // resize observer
    const { ro, resize } = registerResizeObserver(term, containerRef.current!)

    helloMessage(term)

    return () => {
      closeSocket()
      unregisterResizeObserver(ro, resize)
      term.dispose()
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

export default function TerminalComponent() {
  const [wsUrl, setWsUrl] = useState(getDefaultUrl())

  useEffect(() => {
    console.log('TerminalComponent mounted')
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    // window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      console.log('TerminalComponent unmounted')
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // Use a key to force remount of TerminalInner when wsUrl changes
  // This correctly handles re-initialization of hooks and terminal state.
  return <TerminalInner key={wsUrl} wsUrl={wsUrl} setWsUrl={setWsUrl} />
}

const isTTYdUrl = (url: string) => {
  return url.startsWith('ttyd://') || url.startsWith('ttyds://')
}

const getDefaultUrl = () => {
  return localStorage.getItem('url') || VITE_DEFAULT_TTY_URL
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
  term.writeln('Type "help" or "h" for a list of available commands.')
  term.writeln(`Backend URL: ${getDefaultUrl()} use webrtc : ${getLocalConfig('webrtc')}\n`)
  term.write('> ')
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
  term.write('> ')
}

const handleSecretInput = (term: Terminal): Promise<string> => {
  // prompt the user for a password
  term.writeln('Authentication required. input password:')
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
    term.write('\n> ')
    return Promise.reject()
  }

  const key = args[0]
  if (args.length < 2) {
    if (CONFIG_KEYS.includes(key)) {
      delLocalConfig(key)
      term.writeln(`config ${key} cleared.`)
      term.write('\n> ')
      return Promise.reject()
    }
    term.writeln('Usage: config <key> <value>')
    term.writeln('Example:')
    term.writeln('  config url wss://hbbs.url/ws/id')
    term.writeln('  config url ttyd://ttyd.url')
    term.write('\n> ')
    return Promise.reject()
  }

  if (!CONFIG_KEYS.includes(key)) {
    term.writeln(`Unknown config key: ${key}`)
    term.writeln(`Supported config keys: ${CONFIG_KEYS.join(', ')}`)
    term.write('\n> ')
    return Promise.reject()
  }

  const value = args[1]
  if (setLocalConfig(key, value)) {
    term.writeln(`${key} set to: ${value}`)
    term.write('\n> ')
    return Promise.resolve([key, value])
  }

  term.write('\n> ')
  return Promise.reject()
}
