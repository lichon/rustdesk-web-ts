import { useEffect, useRef, useState } from 'react'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

import useTTY from '../hooks/use-tty'
import useRustDesk from '../hooks/use-rustdesk'

const { VITE_DEFAULT_TTY_URL } = import.meta.env
const TEXT_DECODER = new TextDecoder()
const CONFIG_KEYS = ['debug', 'url', 'webrtc', 'turn-url', 'turn-only']

function TerminalInner({ wsUrl, setWsUrl }: { wsUrl: string, setWsUrl: (url: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const authMode = useRef<boolean>(false)
  const ttyConnected = useRef<boolean>(false)
  const isRustDesk = !isTTYdUrl(wsUrl)

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { open: openTTY, send: sendUserInput, close: closeTTY } = isRustDesk ? useRustDesk({
    url: wsUrl,
    debug: getLocalConfig('debug') === 'true',
    onSocketData: (data: Uint8Array) => {
      termRef.current?.write(TEXT_DECODER.decode(data))
    },
    onSocketOpen: () => {
      console.log('TTYd socket opened')
      authMode.current = false
      ttyConnected.current = true
    },
    onSocketClose(reason) {
      ttyConnected.current = false
      authMode.current = false
      termRef.current?.writeln(`\n\x1b[31mConnection closed. ${reason}\x1b[0m\n`)
    },
    onAuthRequired: async () => {
      authMode.current = true
      // prompt the user for a password
      termRef.current?.write('Authentication required. input password:')
      return new Promise<string>((resolve) => {
        let password = ''
        let listener: IDisposable | undefined = undefined
        const handleData = (data: string) => {
          if (data === '\r') {
            resolve(password)
            listener?.dispose()
            return
          }
          password += data
        }
        listener = termRef.current?.onData(handleData)
      })
    }
  }) : useTTY({ // eslint-disable-line react-hooks/rules-of-hooks
    url: wsUrl.replace('ttyd://', 'ws://').replace('ttyds://', 'wss://'),
    debug: getLocalConfig('debug') === 'true',
    onSocketData: (data: Uint8Array) => {
      termRef.current?.write(TEXT_DECODER.decode(data))
    },
    onSocketOpen: () => {
      console.log('TTYd socket opened')
      authMode.current = false
      ttyConnected.current = true
    },
    onSocketClose(reason) {
      ttyConnected.current = false
      authMode.current = false
      termRef.current?.writeln(`\n\x1b[31mConnection closed. ${reason}\x1b[0m\n`)
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
          term.writeln(`Connecting to ${wsUrl} with webRTC=${getLocalConfig('webrtc')}...`)
          openTTY({
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
          }).catch((err) => { console.log('Config command error', err) })
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
      if (authMode.current) {
        // console.log('In auth mode, ignoring terminal input')
        return
      }
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

    // Activate the WebGL addon
    try {
      term.loadAddon(new WebglAddon())
    } catch (e) {
      console.warn('load xterm webgl error:', e)
    }
    const fit = new FitAddon()
    term.loadAddon(fit)
    const onWindowResize = () => {
      try { fit.fit() } catch { /* ignore */ }
    }
    const ro = new ResizeObserver(() => {
      onWindowResize()
    })
    ro.observe(containerRef.current!)
    term.open(containerRef.current!)
    term.focus()
    window.addEventListener('resize', onWindowResize)

    helloMessage(term)

    return () => {
      closeTTY()
      ro.disconnect()
      term.dispose()
      window.removeEventListener('resize', onWindowResize)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className='h-screen bg-gray-900' />
}

export default function TerminalComponent() {
  const [wsUrl, setWsUrl] = useState(getDefaultUrl())

  useEffect(() => {
    console.log('TerminalComponent mounted')
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
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
    term.write('> ')
    return Promise.reject()
  }

  const key = args[0]
  if (args.length < 2) {
    if (CONFIG_KEYS.includes(key)) {
      delLocalConfig(key)
      term.writeln(`config ${key} cleared.`)
      term.write('> ')
      return Promise.reject()
    }
    term.writeln('Usage: config <key> <value>')
    term.writeln('Example:')
    term.writeln('  config url wss://hbbs.url/ws/id')
    term.writeln('  config url ttyd://ttyd.url')
    term.write('> ')
    return Promise.reject()
  }

  if (!CONFIG_KEYS.includes(key)) {
    term.writeln(`Unknown config key: ${key}`)
    term.writeln(`Supported config keys: ${CONFIG_KEYS.join(', ')}`)
    term.write('> ')
    return Promise.reject()
  }

  const value = args[1]
  if (setLocalConfig(key, value)) {
    term.writeln(`${key} set to: ${value}`)
    term.write('> ')
    return Promise.resolve([key, value])
  }

  term.write('> ')
  return Promise.reject()
}
