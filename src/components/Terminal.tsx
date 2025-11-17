import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

type Props = {
  backend: string
}

export default function TerminalComponent({ backend }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Track if terminal is mounted
  useEffect(() => {
    console.log('TerminalComponent mounted')
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      cols: 80,
      rows: 24,
      fontSize: 14,
      fontFamily: 'Lucida Console, "Courier New", monospace',
      theme: {
        background: '#0b1220', // dark navy
        foreground: '#e6eef8', // light text
        cursor: '#ffffff'
      }
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    // Activate the WebGL addon
    try {
      term.loadAddon(new WebglAddon())
      console.log('xterm webgl renderer loaded')
    } catch (e) {
      console.warn('xterm webgl renderer failed to load:', e)
    }
    // ep terminal fit to container using ResizeObserver
    const ro = new ResizeObserver(() => {
      try { fit.fit() } catch { /* ignore */ }
    })
    ro.observe(containerRef.current!)
    term.open(containerRef.current!)
    term.focus()

    const ws = new WebSocket(`${backend}`, 'tty')

    ws.onopen = () => {
      term.writeln('Connected to websocket backend.')
      ws.send(new TextEncoder().encode(
        JSON.stringify({
          AuthToken: '',
          columns: term.cols,
          rows: term.rows
        })))
    }

    ws.onmessage = async (event: MessageEvent) => {
      const eventData = event.data as Blob
      if (eventData.size < 1) {
        return
      }
      const dataBytes = await eventData.arrayBuffer()
      const line = new TextDecoder().decode(dataBytes)
      const msgType = line.at(0)
      switch (msgType) {
        case '0':
          term.write(line.slice(1))
          break
        case '1':
          console.log('info:', line.slice(1))
          break
        case '2':
          console.log('is windows:', line.slice(1))
          break
        default:
          console.warn('Unknown message type:', msgType)
      }
    }

    ws.onclose = () => {
      term.writeln('\r\nConnection closed.')
    }

    ws.onerror = (error) => {
      console.error('WebSocket Error: ', error)
      term.writeln('\r\nWebSocket error.')
    }

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode('0' + data))
      }
    })

    // Also handle window resize as a fallback
    function onWindowResize() {
      try { fit.fit() } catch { /* ignore */ }
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      ws?.close()
      ro.disconnect()
      term.dispose()
      window.removeEventListener('resize', onWindowResize)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Make the terminal container fill the entire viewport height and use a dark background
  return <div ref={containerRef} className="h-screen bg-gray-900" />
}
