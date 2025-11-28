import { type ITerminalAddon, Terminal } from '@xterm/xterm'

export class LocalCliAddon implements ITerminalAddon {
  private term!: Terminal
  private currentLine: string = ''
  private cursorPos: number = 0
  private startOfLine: string = '> '
  private commandHandlers: Record<string, (args: string[]) => Promise<void>> = {}
  private commandHistory: string[] = []
  private historyCursor: number = 0
  private historySize: number;

  constructor(
    {
      historySize = 100,
      startOfLine = undefined
    }: {
      historySize?: number,
      startOfLine?: string
    } = {}) {
    this.historySize = historySize
    this.startOfLine = startOfLine || '> '
  }

  activate(terminal: Terminal): void {
    this.term = terminal
  }

  dispose(): void {
    this.commandHandlers = {}
  }

  get currentInput(): string {
    return this.currentLine
  }

  writePrompt = () => {
    this.term.write(this.startOfLine)
  }

  defaultCommandHandler = (_cmd: string, _args: string[]) => {
    // this.term.writeln(`Command not found: ${cmd}`)
    this.writePrompt()
  }

  registerCommandHandler(command: string[], handler: (args: string[]) => Promise<void>) {
    for (const cmd of command) {
      if (this.commandHandlers[cmd]) {
        console.warn(`Command '${cmd}' is already registered. Overwriting.`)
      }
      this.commandHandlers[cmd] = handler
    }
  }

  processCommand = (line: string, useDefault: boolean = true) => {
    const parts: string[] = []
    const tokenRegex = /((?:[^\s"']+|"[^"]*"|'[^']*'|["'])+)/g

    for (const match of line.matchAll(tokenRegex)) {
      const token = match[0]
      let arg = ''
      const quoteRegex = /"([^"]*)"|'([^']*)'|([^\s"']+|["'])/g
      for (const quoteMatch of token.matchAll(quoteRegex)) {
        if (quoteMatch[1] !== undefined) {
          arg += quoteMatch[1]
        } else if (quoteMatch[2] !== undefined) {
          arg += quoteMatch[2]
        } else {
          arg += quoteMatch[3]
        }
      }
      parts.push(arg)
    }

    if (parts.length === 0) {
      this.writePrompt()
      return
    }

    const [command, ...args] = parts
    const handler = this.commandHandlers[command]
    if (handler) {
      this.term.options.disableStdin = true
      handler(args).then(() => {
      }).catch((err) => {
        if (!err) return
        this.term.writeln(`\n\x1b[31mError: ${err.message}\x1b[0m\n`)
      }).finally(() => {
        this.writePrompt()
        this.term.options.disableStdin = false
      })
      return
    }
    if (useDefault) {
      this.defaultCommandHandler(command, args)
    }
  }

  private _clearLine() {
    this.term.write('\r' + this.startOfLine + ' '.repeat(this.currentLine.length))
    this.term.write('\r' + this.startOfLine)
  }

  private _showHistory() {
    this._clearLine()
    this.currentLine = this.commandHistory[this.historyCursor] || ''
    this.term.write(this.currentLine)
    this.cursorPos = this.currentLine.length
  }

  private isFullWidth(char: string) {
    const code = char.codePointAt(0)
    if (!code) return false
    return (code >= 0x1100 && (
      code <= 0x115f ||  // Hangul Jamo
      code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || // CJK Radicals Supplement .. Yi Radicals
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    ))
  }

  handleOtherInput = (data: string) => {
    if (data[0] != '\u001b') {
      Array.from(data).forEach(c => this.handleSingleCharInput(c));
      return
    }

    // Handle ANSI escape sequences
    switch (data.substring(1)) {
      case "[A": // Up arrow
        if (this.historyCursor > 0) {
          this.historyCursor--
          this._showHistory()
        }
        break;
      case "[B": // Down arrow
        if (this.historyCursor < this.commandHistory.length) {
          this.historyCursor++
          this._showHistory()
        }
        break;
      case "[D": // Left Arrow
        if (this.cursorPos > 0) {
          const char = [...this.currentLine.slice(0, this.cursorPos)].pop() || ''
          const visualLen = this.isFullWidth(char) ? 2 : 1
          this.term.write(`\u001b[${visualLen}D`)
          this.cursorPos -= char.length
        }
        break;
      case "[C": // Right Arrow
        if (this.cursorPos < this.currentLine.length) {
          const char = [...this.currentLine.slice(this.cursorPos)][0] || ''
          const visualLen = this.isFullWidth(char) ? 2 : 1
          this.term.write(`\u001b[${visualLen}C`)
          this.cursorPos += char.length
        }
        break;
      case "[3~": // Delete
        if (this.cursorPos < this.currentLine.length) {
          const char = [...this.currentLine.slice(this.cursorPos)][0] || ''
          const visualLen = this.isFullWidth(char) ? 2 : 1
          const right = this.currentLine.slice(this.cursorPos + char.length)
          const rightVisualLen = [...right].reduce((acc, c) => acc + (this.isFullWidth(c) ? 2 : 1), 0)
          this.term.write(right + ' '.repeat(visualLen) + '\b'.repeat(rightVisualLen + visualLen))
          this.currentLine = this.currentLine.slice(0, this.cursorPos) + right
        }
        break;
      case "[F": // End
        if (this.cursorPos < this.currentLine.length) {
          const move = this.currentLine.length - this.cursorPos
          this.term.write(`\u001b[${move}C`)
          this.cursorPos = this.currentLine.length
        }
        break;
      case "[H": // Home
        if (this.cursorPos > 0) {
          this.term.write(`\u001b[${this.cursorPos}D`)
          this.cursorPos = 0
        }
        break;
      default:
        console.log(`Unhandled ANSI sequence: ${JSON.stringify(data)}`);
    }
  }

  handleCtrlInput = (char: string) => {
    switch (char) {
      case '\u0001': // Ctrl+A
        if (this.cursorPos > 0) {
          this.term.write(`\u001b[${this.cursorPos}D`)
          this.cursorPos = 0
        }
        break
      case '\u0005': // Ctrl+E
        if (this.cursorPos < this.currentLine.length) {
          const move = this.currentLine.length - this.cursorPos
          this.term.write(`\u001b[${move}C`)
          this.cursorPos = this.currentLine.length
        }
        break
      case '\u0015': // Ctrl+U
        if (this.cursorPos > 0) {
          const right = this.currentLine.slice(this.cursorPos)
          this.term.write('\b'.repeat(this.cursorPos) + right)
          this.term.write(' '.repeat(this.cursorPos))
          this.term.write('\b'.repeat(this.currentLine.length))
          this.currentLine = right
          this.cursorPos = 0
        }
        break
      case '\u000b': // Ctrl+K
        if (this.cursorPos < this.currentLine.length) {
          const right = this.currentLine.slice(this.cursorPos)
          this.term.write(' '.repeat(right.length))
          this.term.write('\b'.repeat(right.length))
          this.currentLine = this.currentLine.slice(0, this.cursorPos)
        }
        break
      default:
        break
    }
  }

  handleSingleCharInput = (char: string) => {
    const charCode = char.charCodeAt(0)
    if (char === '\r') { // Enter
      this.term.writeln('')
      if (this.currentLine.trim()) {
        if (this.commandHistory.at(-1) !== this.currentLine) {
          this.commandHistory.push(this.currentLine)
          if (this.commandHistory.length > this.historySize) {
            this.commandHistory.shift()
          }
        }
        this.processCommand(this.currentLine)
      } else {
        this.writePrompt()
      }
      this.currentLine = ''
      this.cursorPos = 0
      this.historyCursor = this.commandHistory.length
    } else if (char === '\u007f') { // Backspace
      if (this.cursorPos > 0) {
        const charToRemove = [...this.currentLine.slice(0, this.cursorPos)].pop() || ''
        const visualLen = this.isFullWidth(charToRemove) ? 2 : 1
        const left = this.currentLine.slice(0, this.cursorPos - charToRemove.length)
        const right = this.currentLine.slice(this.cursorPos)
        const rightVisualLen = [...right].reduce((acc, c) => acc + (this.isFullWidth(c) ? 2 : 1), 0)
        this.term.write('\b'.repeat(visualLen) + right + ' '.repeat(visualLen) + '\b'.repeat(rightVisualLen + visualLen))
        this.currentLine = left + right
        this.cursorPos -= charToRemove.length
      }
    } else if (char === '\u0003') { // Ctrl+C
      this.term.write('^C\n')
      this.writePrompt()
      this.currentLine = ''
      this.cursorPos = 0
    } else if (charCode >= '\u0000'.charCodeAt(0) && charCode <= '\u001f'.charCodeAt(0)) {
      this.handleCtrlInput(char)
    } else {
      const left = this.currentLine.slice(0, this.cursorPos)
      const right = this.currentLine.slice(this.cursorPos)
      const rightVisualLen = [...right].reduce((acc, c) => acc + (this.isFullWidth(c) ? 2 : 1), 0)
      this.term.write(char + right + '\b'.repeat(rightVisualLen))
      this.currentLine = left + char + right
      this.cursorPos += char.length
      this.historyCursor = this.commandHistory.length
    }
  }

  handleTermInput = (data: string) => {
    if (!data) return
    if (data.length === 1) {
      this.handleSingleCharInput(data)
      return
    }
    // paste?
    if (data.length > 3 && data[0] !== '\u001b') {
      const normData = data.replace(/[\r\n]+/g, "\r")
      Array.from(normData).forEach(c => this.handleSingleCharInput(c));
    } else {
      this.handleOtherInput(data)
    }
  }

  private connectedLineBuffer: string = ''

  // When connected, only handle local commands starting with '#'
  handleConnectedInput = (data: string) => {
    if (data.length > 1) return

    if (data === '\r') { // Enter
      if (this.connectedLineBuffer.trim()) {
        this.processCommand(this.connectedLineBuffer.substring(1)) // skip '#'
      }
      this.connectedLineBuffer = ''
    } else if (data === '\u007f') { // Backspace
      if (this.connectedLineBuffer.length > 0) {
        this.connectedLineBuffer = this.connectedLineBuffer.slice(0, -1)
        return
      }
    } else if (data === '\u0003') { // Ctrl+C
      this.connectedLineBuffer = ''
    }

    if (this.connectedLineBuffer.length > 0) {
      this.connectedLineBuffer += data
      return
    }
    if (data === '#') {
      this.connectedLineBuffer = data
    }
  }
}
