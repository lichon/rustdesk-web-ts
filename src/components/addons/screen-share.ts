import { type ITerminalAddon, Terminal } from '@xterm/xterm'

const MAGIC_START = 0x07
const BUFFER_SIZE = 10240
const MAGIC_STRING_BYTES = new TextEncoder().encode('::SSC:')

const DEFAULT_STUN_SERVER: RTCIceServer = {
  urls: [
    'stun:stun.cloudflare.com:3478',
    'stun:stun.nextcloud.com:3478',
    'stun:stun.nextcloud.com:443',
  ]
}

type ScreenShareOptions = {
  ssc_dir?: string
}

export class ScreenShareAddon implements ITerminalAddon {
  private term!: Terminal
  private video: HTMLVideoElement

  private buffer: Uint8Array = new Uint8Array(BUFFER_SIZE)
  private bufferIndex = 0
  private matchState = 0

  private pc: RTCPeerConnection | null = null

  private ssc_dir = ''

  constructor({ ssc_dir = '' }: ScreenShareOptions = {}) {
    this.ssc_dir = ssc_dir
    this.video = document.createElement('video')
    this.video.className =
      'rounded-[10px] absolute top-4 right-4 ' +
      'h-[30%] aspect-video bg-black z-[10]'
    this.video.autoplay = true
    this.video.muted = true
    this.video.playsInline = true
    this.video.controls = true
    this.video.onenterpictureinpicture = () => {
      this.video.style.visibility = 'hidden'
    }
    this.video.onleavepictureinpicture = () => {
      this.video.style.visibility = 'visible'
    }
    this.video.onloadedmetadata = () => {
      this.video.play().catch(err => {
        console.error('Failed to play video', err)
      })
      this.video.requestPictureInPicture().catch(err => {
        console.error('Failed to enter Picture-in-Picture mode', err)
      })
    }
  }

  activate(terminal: Terminal): void {
    this.term = terminal
  }

  // used by addon manager
  dispose(): void {
    this.close()
  }

  close(): void {
    this.video.remove()
    this.pc?.close()
    this.pc = null
  }

  async requestDataChannel(args: string[]): Promise<string> {
    if (args.includes('-h') || args.includes('--help') || args.includes('--close')) {
      return `${this.ssc_dir}ssc ${args.join(' ')}`
    }
    if (this.pc) {
      return 'echo "Screen share session already exists"'
    }
    const pc = this.pc = new RTCPeerConnection({
      iceServers: [DEFAULT_STUN_SERVER]
    })
    const dc = pc.createDataChannel('bootstrap')
    let mediaPc: RTCPeerConnection | null = null
    dc.onopen = () => {
      // send video request
      this._requestScreenShare().then(pc => {
        if (pc === null) {
          // TODO add log
          this.pc?.close()
        }
        mediaPc = pc
        const sdp = mediaPc.localDescription!
        dc.send(JSON.stringify(sdp))
      })
    }
    dc.onmessage = (event) => {
      if (mediaPc === null) {
        console.error('No media peer connection to accept answer')
        return
      }
      const ans = JSON.parse(event.data)
      if (ans?.type !== 'answer') {
        console.error('Invalid answer received', ans)
        return
      }
      mediaPc.setRemoteDescription(new RTCSessionDescription(ans))
    }
    dc.onclose = () => {
      mediaPc?.close()
      this.close()
    }

    await pc.setLocalDescription(await pc.createOffer())
    // wait for ICE gathering to complete
    await new Promise((resolve) => {
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          resolve(null)
        }
      }
      // in case icegatheringstatechange doesn't fire
      setTimeout(resolve, 1000)
    })
    setTimeout(() => {
      if (pc.signalingState == 'have-local-offer') {
        dc.close()
        this.close()
      }
    }, 30000) // timeout after 30 seconds
    const offer = pc.localDescription?.sdp
    return `${this.ssc_dir}ssc ${args.join(' ')} -o ${btoa(offer || '')}`
  }

  async _requestScreenShare() {
    const pc = new RTCPeerConnection({
      iceServers: [DEFAULT_STUN_SERVER]
    })

    const term = this.term!
    if (!this.video.parentNode) {
      term.element?.appendChild(this.video)
    }

    const stream = this.video.srcObject as MediaStream | null
    const video = this.video
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      this.video.srcObject = null
    }
    const newStream = new MediaStream()
    pc.ontrack = (event) => {
      if (!event.track) {
        return
      }
      newStream.addTrack(event.track)
      if (!video.srcObject) {
        video.srcObject = newStream
      }
    }
    // prepare offer
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    await pc.setLocalDescription(await pc.createOffer())
    // wait for ICE gathering to complete
    await new Promise((resolve) => {
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          resolve(null)
        }
      }
      // in case icegatheringstatechange doesn't fire
      setTimeout(resolve, 1000)
    })
    return pc
  }

  _acceptAnswer(answerB64: string) {
    if (!this.pc) {
      console.error('No peer connection to accept answer')
      return
    }
    const answerSdp = atob(answerB64)
    this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answerSdp
    })).catch(err => {
      console.error('Failed to set remote description', err)
    })
  }

  _reset() {
    this.bufferIndex = 0
    this.matchState = 0
  }

  _filterByByte(byte: number) {
    if (this.matchState === 2) {
      // Ignore CR (0x0D) and LF (0x0A) bytes
      if (byte === 0x0D || byte === 0x0A || byte === ' '.charCodeAt(0)) {
        return
      }
      if (byte === '.'.charCodeAt(0)) { // End of data marker
        const sscMessage = new TextDecoder().decode(this.buffer.slice(0, this.bufferIndex)).trim()
        if (sscMessage.startsWith('OFFER:')) {
          // handle offer, not supported in this side
          // console.log('offer', atob(sscMessage.substring(6)))
        } else if (sscMessage.startsWith('ANSWER:')) {
          // handle answer
          console.log('answer', sscMessage)
          this._acceptAnswer(sscMessage.substring(7))
        } else if (sscMessage.startsWith('CLOSE:')) {
          // handle close
          this.close()
        }
        this._reset()
      } else {
        if (this.bufferIndex < BUFFER_SIZE) {
          this.buffer[this.bufferIndex++] = byte
        } else {
          // buffer overflow, reset
          this._reset()
        }
      }
      return
    }
    if (this.matchState === 1) {
      if (this.bufferIndex < MAGIC_STRING_BYTES.length) {
        this.buffer[this.bufferIndex++] = byte
        if (this.bufferIndex === MAGIC_STRING_BYTES.length) {
          let matched = true
          for (let i = 0; i < MAGIC_STRING_BYTES.length; i++) {
            if (this.buffer[i] !== MAGIC_STRING_BYTES[i]) {
              matched = false
              break
            }
          }
          if (matched) {
            this.matchState = 2
            this.bufferIndex = 0 // Clear buffer for data
          } else {
            this._reset()
          }
        }
      }
      return
    }
    if (byte === MAGIC_START && this.matchState === 0) {
      this.matchState = 1
      this.bufferIndex = 0
    } else {
      this._reset()
    }
  }

  handleTermOutput = (uint8Array: Uint8Array) => {
    for (const x of uint8Array) {
      this._filterByByte(x)
    }
  }
}
