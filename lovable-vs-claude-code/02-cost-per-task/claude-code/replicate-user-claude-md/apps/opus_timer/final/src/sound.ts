// A short, soft two-note chime made with Web Audio (no audio files).
let ctx: AudioContext | null = null

/** Create/resume the audio context. Call from a user gesture so later chimes are allowed to play. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // Web Audio unavailable: stay silent
  }
}

export function playChime() {
  unlockAudio()
  if (!ctx) return
  const t = ctx.currentTime
  ;[
    [659.25, 0],
    [880, 0.18],
  ].forEach(([freq, delay]) => {
    const osc = ctx!.createOscillator()
    const gain = ctx!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t + delay)
    gain.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6)
    osc.connect(gain).connect(ctx!.destination)
    osc.start(t + delay)
    osc.stop(t + delay + 0.65)
  })
  // Hook for automated tests to observe that a chime was requested.
  ;(window as unknown as { __chimes?: number }).__chimes = ((window as unknown as { __chimes?: number }).__chimes ?? 0) + 1
}
