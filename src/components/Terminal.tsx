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
import useTTY from '../hooks/use-tty'
import useRustDesk from '../hooks/use-rustdesk'

const { VITE_DEFAULT_TTY_URL } = import.meta.env
const TEXT_DECODER = new TextDecoder()
const CONFIG_KEYS = [
  'debug', // boolean enable message debug logging
  'url', // string backend url
  'webrtc', // boolean enable webrtc
  'turn-url', // string turn server url, turn://user:pass@host:port
  'turn-only', // boolean use only turn server
  'trzsz', // boolean enable trzsz file transfer
  'zmodem' // boolean enable zmodem file transfer
]

function TerminalInner({ wsUrl, setWsUrl }: { wsUrl: string, setWsUrl: (url: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const zmodemRef = useRef<ZmodemAddon | null>(null)
  const ttyConnected = useRef<boolean>(false)
  const isRustDesk = !isTTYdUrl(wsUrl)

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { open: openSocket, send: sendUserInput, close: closeSocket } = isRustDesk ? useRustDesk({
    url: wsUrl,
    onSocketData: (data: Uint8Array) => {
      if (zmodemRef.current)
        zmodemRef.current.consume(data.slice(0).buffer)
      else {
        termRef.current?.write(TEXT_DECODER.decode(data))
      }
    },
    onSocketOpen: () => {
      console.log('TTYd socket opened')
      ttyConnected.current = true
      termRef.current!.options.disableStdin = false
    },
    onSocketClose(reason) {
      ttyConnected.current = false
      termRef.current!.options.disableStdin = false
      termRef.current?.writeln(`\n\x1b[31mConnection closed. ${reason}\x1b[0m\n`)
      termRef.current?.write('> ')
    },
    onAuthRequired: async () => {
      // prompt the user for a password
      termRef.current?.writeln('Authentication required. input password:')
      termRef.current!.options.disableStdin = true
      return new Promise<string>((resolve) => {
        let password = ''
        let listener: IDisposable | undefined = undefined
        listener = termRef.current?.onKey((ev) => {
          if (ev.key === '\r') {
            listener?.dispose()
            resolve(password)
            setTimeout(() => {
              termRef.current!.options.disableStdin = false
            })
          } else if (ev.key === '\u007f') { // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1)
            }
          } else if (ev.key.length === 1) {
            password += ev.key
          }
        })
      })
    }
  }) : useTTY({ // eslint-disable-line react-hooks/rules-of-hooks
    url: wsUrl.replace('ttyd://', 'ws://').replace('ttyds://', 'wss://'),
    onSocketData: (data: Uint8Array, buffer?: ArrayBuffer) => {
      if (zmodemRef.current && buffer)
        zmodemRef.current.consume(buffer?.slice(1))
      else {
        termRef.current?.write(TEXT_DECODER.decode(data))
      }
    },
    onSocketOpen: () => {
      console.log('TTYd socket opened')
      ttyConnected.current = true
    },
    onSocketClose(reason) {
      ttyConnected.current = false
      termRef.current?.writeln(`\n\x1b[31mConnection closed. ${reason}\x1b[0m\n`)
      termRef.current?.write('> ')
    },
    onAuthRequired: async () => {
      // TODO implement auth for ttyd
      return Promise.resolve('')
    }
  })

  useEffect(() => {
    console.log('TerminalInner mounted with wsUrl:', wsUrl)
    if (!containerRef.current) return

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
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

    let currentLine = ''
    const processCommand = (line: string) => {
      const [command, ...args] = line.trim().split(' ')
      switch (command) {
        case 'h':
        case 'help':
          helpMessage(term)
          break
        case 'r':
        case 'reload':
          window.location.reload()
          break
        case 'c':
        case 'connect':
          term.writeln(`Connecting to ${wsUrl}..., enable webrtc: ${getLocalConfig('webrtc')}`)
          openSocket({
            useWebRTC: getLocalConfig('webrtc') === 'true',
            cols: fit.proposeDimensions()?.cols || 80,
            rows: fit.proposeDimensions()?.rows || 24,
            targetId: args[0]
          }).catch((err) => {
            term.writeln(`\n\x1b[31mError: ${err.message}\x1b[0m\n`)
            term.write('> ')
          })
          break
        case 'config':
          handleConfigCommand(term, args).then(([key, value]) => {
            key === 'url' && setWsUrl(value) // eslint-disable-line
          }).catch(() => { /* ignore */ })
          break
        case 'clear':
          term.clear()
          term.write('> ')
          break
        default:
          term.write('> ')
          break
      }
    }

    term.onData((data: string) => {
      if (ttyConnected.current) {
        sendUserInput(data)
        return
      }
      const char = data
      if (char === '\r') { // Enter
        term.writeln('')
        if (currentLine.trim()) {
          processCommand(currentLine)
        } else {
          term.write('> ')
        }
        currentLine = ''
      } else if (char === '\u007f') { // Backspace
        if (currentLine.length > 0) {
          term.write('\b \b')
          currentLine = currentLine.slice(0, -1)
        }
      } else {
        currentLine += char
        term.write(char)
      }
    })

    loadAddons(term)
    // fit addon
    const fit = new FitAddon()
    term.loadAddon(fit)
    const onWindowResize = () => {
      try {
        // TODO sendUserInput resize event to backend
      } catch { /* ignore */ }
      try { fit.fit() } catch { /* ignore */ }
    }
    const ro = new ResizeObserver(() => {
      onWindowResize()
    })
    ro.observe(containerRef.current!)

    // open the terminal
    term.open(containerRef.current!)
    term.focus()
    // load zmodem addon after terminal is opened
    zmodemRef.current = loadZmodemAddon(term, sendUserInput)
    window.addEventListener('resize', onWindowResize)

    helloMessage(term)

    return () => {
      closeSocket()
      ro.disconnect()
      term.dispose()
      window.removeEventListener('resize', onWindowResize)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className='h-screen bg-gray-900' />
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
    windows: true,
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
