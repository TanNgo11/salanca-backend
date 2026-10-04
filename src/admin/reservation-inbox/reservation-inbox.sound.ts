/** Rising G5–C6–E6 bell; each note rings out so the whole chime lasts ~1.2s. */
const CHIME_NOTES_HZ = [784, 1047, 1319] as const;
const NOTE_GAP_S = 0.18;
const NOTE_RING_S = 0.8;
const PEAK_GAIN = 0.22;

export const playReservationInboxChime = (): void => {
  try {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    const context = new AudioContextConstructor();
    const startedAt = context.currentTime;
    const oscillators = CHIME_NOTES_HZ.map((frequency, index) => {
      const noteStart = startedAt + index * NOTE_GAP_S;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + NOTE_RING_S);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + NOTE_RING_S);
      return oscillator;
    });

    oscillators[oscillators.length - 1].onended = () => {
      void context.close().catch(() => {});
    };
  } catch {
    // Audio output is best-effort; never surface failures to staff.
  }
};
