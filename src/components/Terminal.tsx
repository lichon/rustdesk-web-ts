import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import useTTY from '../hooks/use-tty'
import useRustDesk from '../hooks/use-rustdesk'

type TerminalProps = {
  websocketUrl?: string
  isRustDesk?: boolean
}

export default function TerminalComponent({ websocketUrl, isRustDesk = true }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const { open: openTTY, send: sendUserInput, close: closeTTY } = isRustDesk ? useRustDesk({
    url: websocketUrl || "http://127.0.0.1/ws/id",
    onSocketData: (data: Uint8Array) => {
      termRef.current?.write(new TextDecoder().decode(data))
    },
    onAuthRequired: async () => {
      // In a real application, you would prompt the user for a password
      return Promise.resolve('')
    }
  }) : useTTY({
    url: websocketUrl || 'ws://127.0.0.1:1122',
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
      fontFamily: 'Lucida Console, "Courier New", monospace',
      theme: {
        background: '#0b1220', // dark navy
        foreground: '#e6eef8', // light text
        cursor: '#ffffff'
      }
    })
    termRef.current = term
    term.onData((data: string) => {
      sendUserInput(data)
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

    openTTY({
      cols: fit.proposeDimensions()?.cols || 80,
      rows: fit.proposeDimensions()?.rows || 24
    }).catch((err) => {
      term.writeln(`\n\x1b[31mError: Failed to connect to terminal. ${err.message}\x1b[0m\n`)
    })

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
