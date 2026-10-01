'use strict';
// Музыка «Топографа»: на каждый участок своя инструментальная тема, синтезируется на лету (Web Audio, без файлов).
// Трек = темп, лад, гармония по тактам и слои (бас, аккомпанемент, мелодия, ударные). Мелодии сочиняются детерминированно из зерна трека:
// мотив на 2 такта, форма A A′ B A, на сильных долях — звуки аккорда. Когда времени на уровне мало, включается напряжённый слой.
const Music = (() => {
  const NOTE = m => 440 * Math.pow(2, (m - 69) / 12);
  const MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], pentaMaj: [0, 2, 4, 7, 9], pentaMin: [0, 3, 5, 7, 10] };
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- треки ----------
  // prog — ступени лада по тактам (0 = тоника); layers: inst, pat — 16 шагов на такт ('x' удар, '.' пауза, '-' держать),
  // role: bass | chord | arp | melody | drum; oct — октавный сдвиг; min — слой только при напряжении (intensity ≥ min)
  const TRACKS = {
    menu: { bpm: 104, root: 55, mode: 'major', prog: [0, 5, 3, 4, 0, 5, 3, 4], seed: 11, layers: [
      { role: 'bass', inst: 'bass', pat: 'x...x...x...x.x.' },
      { role: 'chord', inst: 'pad', pat: 'x---------------', vol: 0.5 },
      { role: 'arp', inst: 'pluck', pat: 'x.x.x.x.x.x.x.x.', oct: 1, vol: 0.5 },
      { role: 'melody', inst: 'lead', oct: 1, density: 0.55 },
      { role: 'drum', inst: 'kick', pat: 'x.......x.......' }, { role: 'drum', inst: 'hat', pat: '..x...x...x...x.', vol: 0.5 } ] },
    'piket/village': { bpm: 100, root: 57, mode: 'major', prog: [0, 3, 4, 0, 0, 3, 4, 0], seed: 21, birds: true, layers: [ // деревня: щипковые, «баян»
      { role: 'bass', inst: 'bass', pat: 'x.......x.......' },
      { role: 'arp', inst: 'pluck', pat: 'x...x.x.x...x.x.', oct: 1, vol: 0.6 },
      { role: 'melody', inst: 'accordion', oct: 1, density: 0.6 },
      { role: 'drum', inst: 'shaker', pat: '..x...x...x...x.', vol: 0.5 },
      { role: 'drum', inst: 'hat', pat: 'x.x.x.x.x.x.x.x.', vol: 0.4, min: 1 }, { role: 'drum', inst: 'kick', pat: 'x.......x.......', min: 1 } ] },
    'piket/park': { bpm: 88, root: 60, mode: 'lydian', prog: [0, 1, 0, 4, 0, 1, 5, 4], seed: 32, birds: true, layers: [ // парк: спокойно
      { role: 'bass', inst: 'bass', pat: 'x---------x-----' },
      { role: 'chord', inst: 'pad', pat: 'x---------------', vol: 0.6 },
      { role: 'arp', inst: 'pluck', pat: 'x..x..x..x..x...', oct: 1, vol: 0.5 },
      { role: 'melody', inst: 'flute', oct: 1, density: 0.4 },
      { role: 'drum', inst: 'shaker', pat: 'x.x.x.x.x.x.x.x.', vol: 0.4, min: 1 } ] },
    'traverse/block': { bpm: 96, root: 52, mode: 'minor', prog: [0, 5, 2, 6, 0, 5, 3, 4], seed: 43, layers: [ // квартал: сосредоточенно
      { role: 'bass', inst: 'bass', pat: 'x.x.....x.x.....' },
      { role: 'arp', inst: 'pluck', pat: 'xxxxxxxxxxxxxxxx', oct: 1, vol: 0.4 },
      { role: 'melody', inst: 'bell', oct: 2, density: 0.25 },
      { role: 'drum', inst: 'click', pat: '....x.......x...', vol: 0.6 },
      { role: 'drum', inst: 'hat', pat: 'x.x.x.x.x.x.x.x.', vol: 0.5, min: 1 } ] },
    'traverse/forest': { bpm: 72, root: 50, mode: 'dorian', prog: [0, 0, 3, 3, 0, 0, 6, 4], seed: 54, frogs: true, layers: [ // лес и болото: загадочно
      { role: 'chord', inst: 'pad', pat: 'x---------------', vol: 0.7, oct: -1 },
      { role: 'bass', inst: 'bass', pat: 'x---------------' },
      { role: 'melody', inst: 'bell', oct: 1, density: 0.2 },
      { role: 'drum', inst: 'wood', pat: 'x.....x.....x...', vol: 0.5 },
      { role: 'arp', inst: 'pluck', pat: 'x.x.x.x.x.x.x.x.', oct: 0, vol: 0.4, min: 1 } ] },
    'staffman/road': { bpm: 132, root: 52, mode: 'mixolydian', prog: [0, 0, 6, 3, 0, 0, 6, 4], seed: 65, layers: [ // трасса: бодро
      { role: 'bass', inst: 'bass', pat: 'x.xxx.x.x.xxx.x.' },
      { role: 'chord', inst: 'stab', pat: '....x.......x...', vol: 0.6 },
      { role: 'melody', inst: 'lead', oct: 1, density: 0.65 },
      { role: 'drum', inst: 'kick', pat: 'x.......x.x.....' }, { role: 'drum', inst: 'snare', pat: '....x.......x...' },
      { role: 'drum', inst: 'hat', pat: 'x.x.x.x.x.x.x.x.', vol: 0.5 }, { role: 'drum', inst: 'hat', pat: '.x.x.x.x.x.x.x.x', vol: 0.4, min: 1 } ] },
    'staffman/river': { bpm: 110, root: 55, mode: 'pentaMaj', prog: [0, 3, 1, 4, 0, 3, 2, 4], seed: 76, layers: [ // река: переливы
      { role: 'bass', inst: 'bass', pat: 'x.....x.....x...' },
      { role: 'arp', inst: 'harp', pat: 'xxxxxxxxxxxxxxxx', oct: 1, vol: 0.45 },
      { role: 'melody', inst: 'flute', oct: 1, density: 0.45 },
      { role: 'drum', inst: 'shaker', pat: 'x.xx.xx.x.xx.xx.', vol: 0.35 },
      { role: 'drum', inst: 'kick', pat: 'x.....x.....x...', min: 1 } ] },
    'locator/yard': { bpm: 104, root: 49, mode: 'minor', prog: [0, 0, 5, 5, 3, 3, 4, 4], seed: 87, pings: true, layers: [ // трассоискатель: поиск
      { role: 'bass', inst: 'pulse', pat: 'x.x.x.x.x.x.x.x.' },
      { role: 'chord', inst: 'pad', pat: 'x---------------', vol: 0.45 },
      { role: 'melody', inst: 'bell', oct: 2, density: 0.3 },
      { role: 'drum', inst: 'click', pat: 'x...x...x...x...', vol: 0.5 },
      { role: 'drum', inst: 'hat', pat: '..x...x...x...x.', vol: 0.5, min: 1 } ] },
    'locator/industrial': { bpm: 116, root: 47, mode: 'phrygian', prog: [0, 1, 0, 6, 0, 1, 3, 1], seed: 98, layers: [ // промзона: механика
      { role: 'bass', inst: 'pulse', pat: 'x..x..x.x..x..x.' },
      { role: 'chord', inst: 'stab', pat: 'x.......x.......', vol: 0.5 },
      { role: 'melody', inst: 'lead', oct: 1, density: 0.35 },
      { role: 'drum', inst: 'metal', pat: '..x...x...x..x.x', vol: 0.5 }, { role: 'drum', inst: 'kick', pat: 'x...x...x...x...' },
      { role: 'drum', inst: 'snare', pat: '....x.......x...', min: 1 } ] },
    'contours/hill': { bpm: 80, root: 60, mode: 'major', prog: [0, 4, 5, 3, 0, 4, 3, 4], seed: 109, layers: [ // горизонтали: вдумчиво
      { role: 'bass', inst: 'bass', pat: 'x-------x-------' },
      { role: 'arp', inst: 'marimba', pat: 'x.x.x.x.x.x.x.x.', oct: 1, vol: 0.5 },
      { role: 'melody', inst: 'bell', oct: 1, density: 0.35 },
      { role: 'drum', inst: 'shaker', pat: '..x...x...x...x.', vol: 0.3, min: 1 } ] },
    'contours/ravine': { bpm: 84, root: 57, mode: 'pentaMin', prog: [0, 3, 2, 4, 0, 3, 1, 4], seed: 120, layers: [ // овраг: финал
      { role: 'bass', inst: 'bass', pat: 'x.......x...x...' },
      { role: 'chord', inst: 'pad', pat: 'x---------------', vol: 0.55 },
      { role: 'arp', inst: 'harp', pat: 'x.xx.xx.x.xx.xx.', oct: 1, vol: 0.4 },
      { role: 'melody', inst: 'lead', oct: 1, density: 0.45 },
      { role: 'drum', inst: 'kick', pat: 'x.......x.......', vol: 0.7 }, { role: 'drum', inst: 'hat', pat: '..x...x...x...x.', vol: 0.4, min: 1 } ] },
  };

  // ---------- сочинение мелодий ----------
  const melodies = {};
  function melodyFor(id, T, layer) { // 8 тактов × 16 шагов: [{ step, deg, len }]
    const key = id + '/' + layer.inst; if (melodies[key]) return melodies[key];
    const R = mulberry(T.seed * 7919 + 3), sc = MODES[T.mode].length, dens = layer.density || 0.5;
    const rhythm = () => { const r = []; for (let s = 0; s < 32; s++) { const strong = s % 4 === 0; if (R() < (strong ? dens + 0.3 : dens * 0.55)) r.push(s); } if (!r.includes(0)) r.unshift(0); return r; };
    const motif = (rh, start) => { let d = start; return rh.map((s, i) => { if (s % 8 === 0) d = [0, 2, 4][Math.floor(R() * 3)] + (R() < 0.3 ? sc : 0); else d += Math.round((R() - 0.5) * 3); d = Math.max(-2, Math.min(sc + 4, d)); const next = rh[i + 1] ?? 32; return { s, d, len: Math.min(next - s, 6) }; }); };
    const rA = rhythm(), A = motif(rA, 2), A2 = A.map((n, i) => i < A.length - 2 ? n : { ...n, d: n.d + (R() < 0.5 ? 1 : -1) }), B = motif(rhythm(), 4);
    const out = [];
    [A, A2, B, A].forEach((m, k) => m.forEach(n => out.push({ step: k * 32 + n.s, deg: n.d, len: n.len })));
    return (melodies[key] = out);
  }

  // ---------- инструменты ----------
  let ac = null, bus = null, noise = null;
  function env(g, t, a, peak, d, sus = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + d); }
  function osc(type, f, t, dur, vol, o = {}) {
    const n = ac.createOscillator(), g = ac.createGain(); n.type = type; n.frequency.setValueAtTime(f, t);
    if (o.detune) n.detune.setValueAtTime(o.detune, t);
    if (o.vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5.5; lg.gain.value = f * 0.012; l.connect(lg); lg.connect(n.frequency); l.start(t); l.stop(t + dur + 0.1); }
    let last = n;
    if (o.lp) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.setValueAtTime(o.lp, t); if (o.lpEnd) f2.frequency.exponentialRampToValueAtTime(o.lpEnd, t + dur); last.connect(f2); last = f2; }
    last.connect(g); g.connect(bus);
    const a = o.a ?? 0.005, d = o.d ?? dur;
    env(g, t, a, vol, d, o.sus);
    if (o.sus) g.gain.setValueAtTime(o.sus, t + dur), g.gain.exponentialRampToValueAtTime(0.0001, t + dur + (o.r ?? 0.2));
    n.start(t); n.stop(t + dur + (o.r ?? 0.2) + 0.05);
  }
  function hit(t, dur, vol, freq, q = 1, type = 'bandpass') {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(g); g.connect(bus); env(g, t, 0.002, vol, dur); s.start(t); s.stop(t + dur + 0.05);
  }
  const INST = {
    bass: (f, t, d, v) => { osc('triangle', f, t, d, 0.32 * v, { d: d * 0.9 }); osc('sine', f / 2, t, d, 0.18 * v, { d: d * 0.9 }); },
    pulse: (f, t, d, v) => osc('square', f, t, Math.min(d, 0.18), 0.12 * v, { lp: 900, lpEnd: 300, d: 0.16 }),
    pluck: (f, t, d, v) => osc('triangle', f, t, 0.3, 0.16 * v, { d: 0.28 }),
    harp: (f, t, d, v) => { osc('triangle', f, t, 0.5, 0.13 * v, { d: 0.5 }); osc('sine', f * 2, t, 0.25, 0.04 * v, { d: 0.25 }); },
    marimba: (f, t, d, v) => { osc('sine', f, t, 0.35, 0.2 * v, { d: 0.33 }); osc('sine', f * 4, t, 0.06, 0.05 * v, { d: 0.05 }); },
    pad: (f, t, d, v) => { for (const dt of [-8, 7]) osc('sawtooth', f, t, d, 0.035 * v, { detune: dt, lp: 1100, a: 0.4, d: 0.3, sus: 0.03 * v, r: 0.6 }); },
    stab: (f, t, d, v) => osc('sawtooth', f, t, 0.18, 0.08 * v, { lp: 2500, lpEnd: 500, d: 0.17 }),
    lead: (f, t, d, v) => osc('square', f, t, d, 0.07 * v, { lp: 2600, vib: true, a: 0.01, d: 0.05, sus: 0.05 * v, r: 0.08 }),
    accordion: (f, t, d, v) => { osc('square', f, t, d, 0.05 * v, { lp: 1800, vib: true, a: 0.03, d: 0.05, sus: 0.045 * v, r: 0.1 }); osc('sawtooth', f * 1.004, t, d, 0.03 * v, { lp: 1500, a: 0.03, d: 0.05, sus: 0.028 * v, r: 0.1 }); },
    flute: (f, t, d, v) => osc('sine', f, t, d, 0.13 * v, { vib: true, a: 0.06, d: 0.08, sus: 0.1 * v, r: 0.15 }),
    bell: (f, t, d, v) => { osc('sine', f, t, 1.2, 0.12 * v, { d: 1.2 }); osc('sine', f * 2.76, t, 0.5, 0.04 * v, { d: 0.5 }); },
    kick: (f, t, d, v) => { const n = ac.createOscillator(), g = ac.createGain(); n.frequency.setValueAtTime(140, t); n.frequency.exponentialRampToValueAtTime(42, t + 0.14); n.connect(g); g.connect(bus); env(g, t, 0.003, 0.45 * v, 0.2); n.start(t); n.stop(t + 0.3); },
    snare: (f, t, d, v) => { hit(t, 0.16, 0.22 * v, 1800, 0.7); osc('triangle', 190, t, 0.08, 0.08 * v, { d: 0.08 }); },
    hat: (f, t, d, v) => hit(t, 0.04, 0.09 * v, 8000, 0.8, 'highpass'),
    shaker: (f, t, d, v) => hit(t, 0.06, 0.07 * v, 5500, 1.2),
    click: (f, t, d, v) => osc('square', 2400, t, 0.02, 0.05 * v, { d: 0.02 }),
    wood: (f, t, d, v) => osc('sine', 900, t, 0.06, 0.12 * v, { d: 0.06 }),
    metal: (f, t, d, v) => { osc('square', 540, t, 0.12, 0.04 * v, { d: 0.12 }); osc('square', 812, t, 0.1, 0.035 * v, { d: 0.1 }); hit(t, 0.08, 0.05 * v, 6000, 3); },
  };

  // ---------- проигрывание ----------
  let curId = null, cur = null, step = 0, nextT = 0, playing = false, intensity = 0, fade = null;
  function degToMidi(T, deg, oct) {
    const sc = MODES[T.mode], n = sc.length, o = Math.floor(deg / n), i = ((deg % n) + n) % n;
    return T.root + sc[i] + 12 * (o + oct);
  }
  function scheduleStep(t) {
    const T = cur, s16 = step % 16, bar = Math.floor(step / 16) % T.prog.length, chordDeg = T.prog[bar], sd = 60 / T.bpm / 4;
    for (const L of T.layers) {
      if ((L.min || 0) > intensity) continue;
      const v = L.vol ?? 1, oct = L.oct || 0;
      if (L.role === 'melody') {
        const pos = step % (T.prog.length * 16), mel = melodyFor(curId, T, L);
        for (const n of mel) if (n.step === pos) INST[L.inst](NOTE(degToMidi(T, chordDeg + n.deg, oct)), t, n.len * sd * 0.95, v);
        continue;
      }
      const ch = L.pat[s16]; if (ch !== 'x') continue;
      let len = 1; while (L.pat[(s16 + len) % 16] === '-' && len < 16) len++;
      const d = len * sd;
      if (L.role === 'drum') { INST[L.inst](0, t, d, v); continue; }
      if (L.role === 'bass') { INST[L.inst](NOTE(degToMidi(T, chordDeg, -1 + oct)), t, d * 0.95, v); continue; }
      if (L.role === 'chord') { for (const k of [0, 2, 4]) INST[L.inst](NOTE(degToMidi(T, chordDeg + k, oct)), t, d, v); continue; }
      if (L.role === 'arp') { const seq = [0, 2, 4, 7, 4, 2]; INST[L.inst](NOTE(degToMidi(T, chordDeg + seq[step % seq.length], oct)), t, d, v); }
    }
    if (T.birds && step % 64 === 37 && Math.random() < 0.6) for (let k = 0; k < 3; k++) osc('sine', 3000 + Math.random() * 900, t + k * 0.07, 0.05, 0.03, { d: 0.05 }); // птицы
    if (T.frogs && step % 32 === 13 && Math.random() < 0.5) osc('square', 180, t, 0.09, 0.03, { lp: 600, d: 0.09 }); // лягушки
    if (T.pings && step % 64 === 50) osc('sine', 1650, t, 0.08, 0.04, { d: 0.08 }); // писк прибора
    step++;
  }
  function update(ctxAudio, out, id, play, inten) { // вызывается каждый кадр из Sound.music
    if (!ctxAudio) return;
    if (ac !== ctxAudio) {
      ac = ctxAudio; bus = ac.createGain(); bus.gain.value = 0; bus.connect(out);
      noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const want = TRACKS[id] ? id : 'menu';
    intensity = inten || 0;
    if (want !== curId) { // смена трека — короткий увод громкости и старт с начала
      curId = want; cur = TRACKS[want]; step = 0; nextT = ac.currentTime + 0.12;
      bus.gain.cancelScheduledValues(ac.currentTime); bus.gain.setValueAtTime(0.0001, ac.currentTime); bus.gain.linearRampToValueAtTime(play ? 1 : 0.0001, ac.currentTime + 1.2);
    }
    if (play !== playing) { playing = play; bus.gain.cancelScheduledValues(ac.currentTime); bus.gain.setTargetAtTime(play ? 1 : 0.0001, ac.currentTime, 0.15); if (play) nextT = Math.max(nextT, ac.currentTime + 0.05); }
    if (!playing) return;
    if (nextT < ac.currentTime - 0.5) nextT = ac.currentTime + 0.05; // вкладка спала — не догоняем пропущенное
    const tempo = cur.bpm * (intensity ? 1.06 : 1), sd = 60 / tempo / 4;
    while (nextT < ac.currentTime + 0.18) { scheduleStep(nextT); nextT += sd; }
  }
  function renderTo(off, id, seconds, inten = 0) { // для проверок и превью: расписать трек в OfflineAudioContext
    const keep = { ac, bus, noise, curId, cur, step, intensity };
    ac = off; bus = off.createGain(); bus.gain.value = 0.5; bus.connect(off.destination);
    noise = off.createBuffer(1, off.sampleRate * 0.5, off.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    curId = id; cur = TRACKS[id]; step = 0; intensity = inten;
    const sd = 60 / (cur.bpm * (inten ? 1.06 : 1)) / 4;
    for (let t = 0.05; t < seconds - 0.5; t += sd) scheduleStep(t);
    ({ ac, bus, noise, curId, cur, step, intensity } = keep);
  }
  return { update, renderTo, tracks: Object.keys(TRACKS), TRACKS };
})();
