import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import useTTY from '../hooks/use-tty'

type TerminalProps = {
  websocketUrl: string
}

export default function TerminalComponent({ websocketUrl }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const { open: openTTY, send: sendUserInput, close: closeTTY } = useTTY({
    url: websocketUrl,
    onSocketData: (data: Uint8Array) => {
      termRef.current?.write(new TextDecoder().decode(data))
    }
  })

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

    openTTY(fit.proposeDimensions()?.cols, fit.proposeDimensions()?.rows)
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
