'use strict';
// Voz local: usa las voces en español que ya trae Windows (sin internet, sin descargas).
// Cada personalidad tiene su voz preferida, velocidad y tono.
(function (root) {
  const clean = (text) => String(text || '')
    .replace(/```[\s\S]*?```/g, ' bloque de código ')
    .replace(/https?:\/\/\S+/g, ' enlace ')
    .replace(/[*_#`>~|]+/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 700);

  const isEs = (v) => /^es([-_]|$)/i.test(v.lang || '');

  /** Elige voz: la que fijaste > las preferidas de la personalidad > otra en español según su orden > la de por defecto. */
  function pickVoice(voices, personality, index = 0) {
    const es = (voices || []).filter(isEs);
    if (personality?.voiceName) {
      const exact = (voices || []).find((v) => v.name === personality.voiceName);
      if (exact) return exact;
    }
    for (const hint of personality?.voiceHints || []) {
      const h = String(hint).toLowerCase();
      const found = es.find((v) => v.name.toLowerCase().includes(h));
      if (found) return found;
    }
    if (es.length) return es[index % es.length];
    return (voices || []).find((v) => v.default) || (voices || [])[0] || null;
  }

  function loadVoices() {
    const synth = root.speechSynthesis;
    if (!synth) return Promise.resolve([]);
    const now = synth.getVoices();
    if (now.length) return Promise.resolve(now);
    return new Promise((resolve) => {
      const done = () => resolve(synth.getVoices());
      synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }

  async function speak(text, personality, index = 0) {
    const synth = root.speechSynthesis;
    const t = clean(text);
    if (!synth || !t) return false;
    synth.cancel();
    const voices = await loadVoices();
    const u = new root.SpeechSynthesisUtterance(t);
    const v = pickVoice(voices, personality, index);
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'es-MX'; }
    u.rate = Number(personality?.rate) || 1;
    u.pitch = Number(personality?.pitch) || 1;
    synth.speak(u);
    return true;
  }

  const stop = () => root.speechSynthesis?.cancel();
  const api = { pickVoice, speak, stop, loadVoices, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaSpeech = api;
})(typeof window !== 'undefined' ? window : globalThis);
