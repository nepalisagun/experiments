let ctx: AudioContext | null = null

/** Create/resume the audio context. Call from a user gesture so later playback is allowed. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

/** A soft two-note chime. */
export function playChime(): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime
    ;[660, 880].forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = t0 + i * 0.22
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t)
      osc.stop(t + 0.65)
    })
    ;(window as unknown as { __chimeCount?: number }).__chimeCount =
      ((window as unknown as { __chimeCount?: number }).__chimeCount ?? 0) + 1
  } catch {
    // Audio unavailable: fail silently.
  }
}
