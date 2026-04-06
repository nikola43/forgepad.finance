// Lightweight trade sound effects using Web Audio API
let audioCtx: AudioContext | null = null

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  return audioCtx
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.08) {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {
    // Audio not supported, fail silently
  }
}

export function playBuySound() {
  playTone(880, 0.12, 'sine', 0.06)
  setTimeout(() => playTone(1100, 0.15, 'sine', 0.05), 80)
}

export function playSellSound() {
  playTone(660, 0.12, 'sine', 0.06)
  setTimeout(() => playTone(440, 0.15, 'sine', 0.05), 80)
}

export function playSuccessSound() {
  playTone(523, 0.1, 'sine', 0.06)
  setTimeout(() => playTone(659, 0.1, 'sine', 0.06), 100)
  setTimeout(() => playTone(784, 0.15, 'sine', 0.06), 200)
}
