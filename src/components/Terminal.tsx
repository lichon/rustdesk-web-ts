import { useEffect, useRef, useState } from 'react'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

import useTTY from '../hooks/use-tty'
import useRustDesk from '../hooks/use-rustdesk'

type TerminalProps = {
  websocketUrl?: string
  isRustDesk?: boolean
}

export default function TerminalComponent({ isRustDesk = true }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const authMode = useRef<boolean>(false)
  const [wsUrl, setWsUrl] = useState("http://localhost/ws/id")

  const { open: openTTY, send: sendUserInput, close: closeTTY } = isRustDesk ? useRustDesk({
    url: wsUrl,
    onSocketData: (data: Uint8Array) => {
      termRef.current?.write(new TextDecoder().decode(data))
    },
    onSocketOpen: () => {
      authMode.current = false
    },
    onSocketClose(reason) {
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
  }) : useTTY({
    url: wsUrl,
    onSocketData: (data: Uint8Array) => {
      termRef.current?.write(new TextDecoder().decode(data))
    },
    onAuthRequired: async () => {
      // In a real application, you would prompt the user for a password
      return Promise.resolve('')
    }
  })

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

  useEffect(() => {
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
        case 'help':
          term.writeln('\nAvailable commands:')
          term.writeln('  connect <id>       - Connect to the server.')
          term.writeln('  set url <new_url>  - Set the websocket URL.')
          term.writeln('  help               - Show this help message.')
          term.writeln('  clear              - Clear the terminal screen.')
          break
        case 'connect':
          openTTY({
            cols: fit.proposeDimensions()?.cols || 80,
            rows: fit.proposeDimensions()?.rows || 24,
            targetId: args[0]
          }).catch((err) => {
            term.writeln(`\n\x1b[31mError: Failed to connect to terminal. ${err.message}\x1b[0m\n`)
          })
          break
        case 'set':
          if (args[0] === 'url' && args[1]) {
            setWsUrl(args[1])
            term.writeln(`\nURL set to: ${args[1]}`)
          } else {
            term.writeln('\nUsage: set url <new_url>')
          }
          break
        case 'clear':
          term.clear()
          break
        case '':
          break
        default:
          sendUserInput(line + '\r')
          break
      }
    }

    term.onData((data: string) => {
      if (authMode.current) {
        // console.log('In auth mode, ignoring terminal input')
        return
      }
      const char = data
      if (char === '\r') { // Enter
        term.writeln('')
        if (currentLine.trim()) {
          processCommand(currentLine)
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
      console.log('xterm webgl renderer loaded')
    } catch (e) {
      console.warn('xterm webgl renderer failed to load:', e)
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

    term.writeln('Welcome to the terminal!')
    term.writeln('Type "help" for a list of available commands.')
    term.writeln(`current websocket URL: ${wsUrl}`)

    return () => {
      closeTTY()
      ro.disconnect()
      term.dispose()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [])

  // Make the terminal container fill the entire viewport height and use a dark background
  return <div ref={containerRef} className="h-screen bg-gray-900" />
}
