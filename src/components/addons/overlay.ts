// ported from hterm.Terminal.prototype.showOverlay
import { type ITerminalAddon, Terminal } from '@xterm/xterm'

export class OverlayAddon implements ITerminalAddon {
  private terminal?: Terminal
  private overlayNode: HTMLElement
  private overlayTimeout?: number

  constructor() {
    this.overlayNode = document.createElement('div')
    this.overlayNode.style.cssText = `border-radius: 15px;
font-size: xx-large;
opacity: 0.75;
padding: 0.2em 0.5em;
position: absolute;
user-select: none;
transition: opacity 180ms ease-in;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
-webkit-user-select: none;
-moz-user-select: none;`

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

    overlayNode.style.color = '#101010'
    overlayNode.style.backgroundColor = '#f0f0f0'
    overlayNode.textContent = msg
    overlayNode.style.opacity = '0.75'

    if (!overlayNode.parentNode) {
      terminal.element.appendChild(overlayNode)
    }

    if (this.overlayTimeout) clearTimeout(this.overlayTimeout)
    if (!timeout) return

    this.overlayTimeout = window.setTimeout(() => {
      overlayNode.style.opacity = '0'
      this.overlayTimeout = window.setTimeout(() => {
        if (overlayNode.parentNode) {
          overlayNode.parentNode.removeChild(overlayNode)
        }
        this.overlayTimeout = undefined
        overlayNode.style.opacity = '0.75'
      }, 200)
    }, timeout || 1500)
  }
}
