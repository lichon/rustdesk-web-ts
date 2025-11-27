'use client'

const default_speak_rate = 1.6

interface TTSOptions {
  voice?: number;
  rate?: number;
  pitch?: number;
  sinkId?: string;
  onEnd?: () => void;
}

export class ChromeTTS {
  private voices: SpeechSynthesisVoice[];
  private audioElement;
  private mediaStream?: MediaStream;

  constructor() {
    this.voices = [];
    this.audioElement = document.createElement('audio');

    if (!ChromeTTS.isSupported()) return;
    window.speechSynthesis.onvoiceschanged = () => {
      this.voices = window.speechSynthesis.getVoices();
    };
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  private async setSinkId(sinkId: string): Promise<void> {
    if (!('setSinkId' in HTMLAudioElement.prototype)) {
      console.warn('setSinkId is not supported in this browser.');
      return Promise.resolve();
    }
    if (!this.mediaStream) {
      return Promise.resolve();
    }

    const audioTrack = this.mediaStream.getAudioTracks()[0]
    const systemDefaultAudio = new MediaStream();
    systemDefaultAudio.addTrack(audioTrack);

    this.audioElement.srcObject = systemDefaultAudio
    this.audioElement.setSinkId(sinkId).then(() => {
      this.audioElement.play();
    });
  }

  private configureUtterance(utterance: SpeechSynthesisUtterance, options: TTSOptions = {}): void {
    if (this.voices.length > 0) {
      utterance.voice = this.voices[0];
    }
    utterance.rate = default_speak_rate;
    utterance.pitch = 1;

    if (options.voice !== undefined && this.voices[options.voice]) {
      utterance.voice = this.voices[options.voice];
    }

    if (options.rate !== undefined) {
      utterance.rate = options.rate;
    }

    if (options.pitch !== undefined) {
      utterance.pitch = options.pitch;
    }
  }

  get displayMedia(): MediaStream | undefined {
    return this.mediaStream;
  }

  public async requestDisplayMedia() { 
    this.mediaStream = await navigator.mediaDevices.getDisplayMedia({ audio: true });
  }

  public async releaseDisplayMedia() { 
    this.mediaStream?.getTracks().forEach(track => track.stop());
  }

  public async pipInput(redirectSound = false, onSubmit?: (txt: string) => void) {
    // eslint-disable-next-line
    const pipWindow = await (window as any).documentPictureInPicture?.requestWindow()
    if (!pipWindow) return
    pipWindow.addEventListener('pagehide', () => {
      this.releaseDisplayMedia()
    })
    // request display audio
    if (redirectSound) {
      this.requestDisplayMedia()
    }

    const tmpInput = document.createElement('input')
    // Set attributes for the input element (optional)
    tmpInput.setAttribute('type', 'text')
    tmpInput.setAttribute('maxLength', '144')

    // Set styles for the input element
    tmpInput.style.width = '100%'
    tmpInput.style.fontSize = '24px'
    tmpInput.style.border = '0px'
    tmpInput.style.outline = 'none'

    tmpInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const txt = tmpInput.value.trim()
        if (!txt) return

        tmpInput.value = ''
        tmpInput.focus()
        if (onSubmit) {
          onSubmit(txt)
          return
        }
        this.speak(txt, {
          sinkId: redirectSound ? 'communications' : undefined,
        })
      }
    })
    // Move the player to the Picture-in-Picture window.
    pipWindow.document.body.append(tmpInput)
  }

  public speak(text: string, options: TTSOptions = {}): void {
    if (!text?.length) return
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    this.configureUtterance(utterance, options);
    utterance.onend = () => {
      if (this.audioElement.srcObject) {
        setTimeout(() => {
          this.audioElement.pause();
          this.audioElement.srcObject = null;
        }, 500);
      }
      if (options.onEnd) {
        options.onEnd();
      }
    };
    if (options.sinkId !== undefined) {
      this.setSinkId(options.sinkId).then(() => {
        window.speechSynthesis.speak(utterance);
      }).catch(error => {
        console.error('Error setting sink ID:', error);
      });
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }

  public pause(): void {
    window.speechSynthesis.pause();
  }

  public resume(): void {
    window.speechSynthesis.resume();
  }

  public stop(): void {
    window.speechSynthesis.cancel();
  }

  static isSupported(): boolean {
    return !!window.speechSynthesis
  }
}
