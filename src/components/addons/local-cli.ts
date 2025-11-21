import { type ITerminalAddon, Terminal } from '@xterm/xterm'

export class LocalCliAddon implements ITerminalAddon {
  private term!: Terminal
  private currentLine: string = ''
  private startOfLine: string = '> '
  private commandHandlers: Record<string, (args: string[]) => void> = {}

  constructor() {
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

  defaultCommandHandler = (args: string[]) => {
    if (args.length > 0)
      this.term.writeln(`Command not found: ${args[0]}`)
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
    const handler = this.commandHandlers[command] || this.defaultCommandHandler
    handler(args)
  }

  handleTermInput = (data: string) => {
    if (data.length !== 1) {
      return
    }

    const currentLine = this.currentLine
    const char = data
    if (char === '\r') { // Enter
      this.term.writeln('')
      if (currentLine.trim()) {
        this.processCommand(currentLine)
      } else {
        this._writeLineStart()
      }
      this.currentLine = ''
    } else if (char === '\u007f') { // Backspace
      if (currentLine.length > 0) {
        this.term.write('\b \b')
        this.currentLine = currentLine.slice(0, -1)
      }
    } else {
      this.term.write(char)
      this.currentLine += char
    }
  }
}
