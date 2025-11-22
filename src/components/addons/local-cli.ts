import { type ITerminalAddon, Terminal } from '@xterm/xterm'

export class LocalCliAddon implements ITerminalAddon {
  private term!: Terminal
  private currentLine: string = ''
  private cursorPos: number = 0
  private startOfLine: string = '> '
  private commandHandlers: Record<string, (args: string[]) => void> = {}
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

  defaultCommandHandler = (_cmd: string, _args: string[]) => {
    // this.term.writeln(`Command not found: ${cmd}`)
    this._writeLineStart()
  }

  registerCommandHandler(command: string[], handler: (args: string[]) => void) {
    for (const cmd of command) {
      if (this.commandHandlers[cmd]) {
        console.warn(`Command '${cmd}' is already registered. Overwriting.`)
      }
      this.commandHandlers[cmd] = handler
    }
  }

  _writeLineStart = () => {
    this.term.write(this.startOfLine)
  }

  processCommand = (line: string) => {
    const [command, ...args] = line.trim().split(' ')
    const handler = this.commandHandlers[command]
    // eslint-disable-next-line
    handler ? handler(args) : this.defaultCommandHandler(command, args)
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

  handleOtherInput = (data: string) => {
    // Handle ANSI escape sequences
    // data len > 1
    if (!data || data[0] != '\u001b') {
      // unknown input, ignore
      console.log(`Unknown input: ${JSON.stringify(data)}`)
      return
    }

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
          this.term.write(data)
          this.cursorPos--
        }
        break;
      case "[C": // Right Arrow
        if (this.cursorPos < this.currentLine.length) {
          this.term.write(data)
          this.cursorPos++
        }
        break;
      case "[3~": // Delete
        if (this.cursorPos < this.currentLine.length) {
          const right = this.currentLine.slice(this.cursorPos + 1)
          this.term.write(right + ' ' + '\b'.repeat(right.length + 1))
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
        this._writeLineStart()
      }
      this.currentLine = ''
      this.cursorPos = 0
      this.historyCursor = this.commandHistory.length
    } else if (char === '\u007f') { // Backspace
      if (this.cursorPos > 0) {
        const left = this.currentLine.slice(0, this.cursorPos - 1)
        const right = this.currentLine.slice(this.cursorPos)
        this.term.write('\b' + right + ' ' + '\b'.repeat(right.length + 1))
        this.currentLine = left + right
        this.cursorPos--
      }
    } else if (char === '\u0003') { // Ctrl+C
      this.term.write('^C\n')
      this._writeLineStart()
      this.currentLine = ''
      this.cursorPos = 0
    } else if (charCode >= '\u0000'.charCodeAt(0) && charCode <= '\u001f'.charCodeAt(0)) {
      this.handleCtrlInput(char)
    } else {
      const left = this.currentLine.slice(0, this.cursorPos)
      const right = this.currentLine.slice(this.cursorPos)
      this.term.write(char + right + '\b'.repeat(right.length))
      this.currentLine = left + char + right
      this.cursorPos++
      this.historyCursor = this.commandHistory.length
    }
  }

  handleTermInput = (data: string) => {
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
}
