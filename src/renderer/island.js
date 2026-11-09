'use strict';
// Arranque de la ventana de la isla: conecta el módulo visual con lo que manda el proceso principal.
(() => {
  const api = window.isla;
  let audio = null;
  function beep(kind) {
    if (!api.soundEnabled?.()) return;
    try {
      audio = audio || new AudioContext();
      const notes = kind === 'done' ? [[660, 0], [880, 0.13]] : [[740, 0]];
      for (const [freq, at] of notes) {
        const o = audio.createOscillator(); const g = audio.createGain();
        o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
        const t = audio.currentTime + at;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t); o.stop(t + 0.25);
      }
    } catch { /* sin audio, no pasa nada */ }
  }

  const ui = window.IslandUI.mount(document.getElementById('host'), api);
  let lastPending = null;
  const apply = (v) => {
    ui.setView(v);
    const cur = v.pending?.[0];
    if (cur && cur.id !== lastPending) { lastPending = cur.id; beep('permission'); ui.announce(`Claude pide permiso: ${cur.toolName}.`); }
    if (!cur) lastPending = null;
  };
  api.onState(apply);
  api.getState().then(apply);
  api.onNotice((n) => { beep(n.kind === 'done' ? 'done' : 'permission'); ui.announce(n.text); ui.showNotice(n.kind, n.text); });
  api.onSpeak?.(({ text, personality, index }) => window.NovaSpeech?.speak(text, personality, index));
  api.onToggle?.(() => ui.toggle());
  api.theme.get().then((t) => ui.setTheme(t)).catch(() => {});
  api.theme.onChange((t) => ui.setTheme(t));
})();
