// ported from hterm.Terminal.prototype.showOverlay
import { type ITerminalAddon, Terminal } from '@xterm/xterm'

export class OverlayAddon implements ITerminalAddon {
  private terminal?: Terminal
  private overlayNode: HTMLElement
  private overlayTimeout?: number

  constructor() {
    this.overlayNode = document.createElement('div')
    this.overlayNode.className =
      'rounded-[15px] text-4xl py-[0.2em] px-[0.5em] absolute select-none ' +
      'transition-opacity duration-[180ms] ease-in top-1/2 left-1/2 ' +
      '-translate-x-1/2 -translate-y-1/2'

    this.overlayNode.addEventListener(
      'mousedown',
      e => {
        e.preventDefault()
        e.stopPropagation()
      },
      true
    )
  }

  activate(terminal: Terminal): void {
    this.terminal = terminal
  }

  dispose(): void { }

  showOverlay(msg: string, timeout?: number): void {
    const terminal = this.terminal!
    const overlayNode = this.overlayNode
    if (!terminal.element) return

    overlayNode.textContent = msg
    overlayNode.classList.add('text-[#101010]', 'bg-[#f0f0f0]')
    overlayNode.classList.remove('opacity-0')
    overlayNode.classList.add('opacity-75')

    if (!overlayNode.parentNode) {
      terminal.element.appendChild(overlayNode)
    }

    if (this.overlayTimeout) clearTimeout(this.overlayTimeout)
    if (!timeout) return

    this.overlayTimeout = window.setTimeout(() => {
      overlayNode.classList.remove('opacity-75')
      overlayNode.classList.add('opacity-0')
      this.overlayTimeout = window.setTimeout(() => {
        if (overlayNode.parentNode) {
          overlayNode.parentNode.removeChild(overlayNode)
        }
        this.overlayTimeout = undefined
        overlayNode.classList.remove('opacity-0')
        overlayNode.classList.add('opacity-75')
      }, 200)
    }, timeout || 1500)
  }
}
