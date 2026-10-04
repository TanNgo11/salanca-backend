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
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startedAt = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, startedAt);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startedAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.15);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startedAt);
    oscillator.stop(startedAt + 0.15);
    oscillator.onended = () => {
      void context.close().catch(() => {});
    };
  } catch {
    // Audio output is best-effort; never surface failures to staff.
  }
};
