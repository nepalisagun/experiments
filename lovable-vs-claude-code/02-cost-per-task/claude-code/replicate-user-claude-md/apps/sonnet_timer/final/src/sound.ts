let ctx: AudioContext | null = null

/** Create/resume the audio context; call from a user gesture so later beeps are allowed. */
export function primeAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    /* no audio support */
  }
}

/** A short two-note chime. */
export function chime() {
  try {
    primeAudio()
    const c = ctx
    if (!c) return
    const t0 = c.currentTime
    ;[660, 880].forEach((freq, i) => {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = t0 + i * 0.22
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      osc.connect(gain).connect(c.destination)
      osc.start(t)
      osc.stop(t + 0.4)
    })
  } catch {
    /* ignore */
  }
}
