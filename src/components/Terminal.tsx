import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function TerminalComponent() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Track if terminal is mounted
  useEffect(() => {
    const handleBeforeUnload = () => {
      return 'Are you sure you want to leave? Changes you made may not be saved.'
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
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace',
      theme: {
        background: '#0b1220', // dark navy
        foreground: '#e6eef8', // light text
        cursor: '#ffffff'
      }
    })

    const fit = new FitAddon()
    term.loadAddon(fit)

    if (!containerRef.current) return
    term.open(containerRef.current)

    term.writeln('Welcome to the web terminal (xterm.js)')
    term.writeln('Type `help` for available commands.')

    let buffer = ''

    function prompt() {
      term.write('\r\n$ ')
      buffer = ''
    }

    prompt()

    term.onData((data: string) => {
      for (const ch of data) {
        if (ch === '\r') {
          const cmd = buffer.trim()
          handleCommand(cmd)
        } else if (ch === '\u0003') {
          // Ctrl+C
          term.write('^C')
          prompt()
        } else if (ch === '\u007f' || ch === '\b') {
          // Backspace
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1)
            term.write('\b \b')
          }
        } else {
          buffer += ch
          term.write(ch)
        }
      }
    })

    function handleCommand(cmd: string) {
      if (!cmd) {
        prompt()
        return
      }
      if (cmd === 'help') {
        term.writeln('\r\nAvailable commands: help, clear, echo <text>')
      } else if (cmd === 'clear') {
        term.clear()
      } else if (cmd.startsWith('echo ')) {
        term.writeln('\r\n' + cmd.slice(5))
      } else {
        term.writeln(`\r\nUnknown command: ${cmd}`)
      }
      prompt()
    }

    // Keep terminal fit to container using ResizeObserver
    const ro = new ResizeObserver(() => {
      try { fit.fit() } catch { /* ignore */ }
    })
    ro.observe(containerRef.current)

    // Also handle window resize as a fallback
    function onWindowResize() {
      try { fit.fit() } catch { /* ignore */ }
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      ro.disconnect()
      term.dispose()
    }
  }, [])

  // Make the terminal container fill the entire viewport height and use a dark background
  return (
    <div ref={containerRef} className="h-screen bg-gray-900" />
  )
}
