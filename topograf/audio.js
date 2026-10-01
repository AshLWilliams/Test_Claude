'use strict';
// Звук «Топографа»: синтезированные эффекты и музыка (music.js — своя тема на каждый участок) либо петли из файлов music/ — на выбор игрока.
// Браузеры разрешают звук только после действия игрока — всё включается при первом нажатии.
const Sound = (() => {
  const MUTE_KEY = 'topograf-muted', MUSIC_VOL = 0.5, SFX_VOL = 0.85;
  let muted = false; try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  let ac = null, master = null, musicOut = null, noiseBuf = null, unlocked = false;
  // Источник музыки: 'synth' — синтез music.js (в конце уровня ускоряется и добавляет напряжённый слой),
  // 'files' — петли из music/ (их делает локальный генератор ACE-Step; список — music/manifest.json), в конце уровня — чуть быстрее.
  const SRC_KEY = 'topograf-music-src';
  let source = 'synth'; try { if (localStorage.getItem(SRC_KEY) === 'files') source = 'files'; } catch (e) {}
  let manifest, manifestReq = null, fileCur = null; const buffers = {}, loading = {};
  const canOgg = (() => { try { return !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
  function loadManifest() {
    if (manifestReq) return manifestReq;
    return (manifestReq = fetch('music/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null).then(m => (manifest = m && m.tracks ? m : null)));
  }
  function loadBuffer(id) {
    const tr = manifest && manifest.tracks[id]; if (!tr || loading[id]) return;
    loading[id] = true;
    const file = canOgg && tr.ogg ? tr.ogg : tr.mp3 || tr.ogg;
    fetch('music/' + file).then(r => r.arrayBuffer()).then(b => new Promise((ok, no) => ac.decodeAudioData(b, ok, no)))
      .then(buf => { buffers[id] = buf; }).catch(() => { buffers[id] = null; });
  }
  function fileStop(fade = 0.6) {
    if (!fileCur) return; const c = fileCur; fileCur = null; const t = ac.currentTime;
    c.gain.gain.cancelScheduledValues(t); c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0, t + fade);
    try { c.src.stop(t + fade + 0.05); } catch (e) {}
  }
  const filesReady = id => !!(manifest && manifest.tracks[id]);
  function fileUpdate(id, play, inten) { // true — играет (или грузится) файл; false — файла нет, нужен синтез
    if (manifest === undefined) { loadManifest(); return true; } // ждём список, пока молчим
    if (!filesReady(id)) { fileStop(); return false; }
    if (!play) { fileStop(0.3); return true; }
    if (buffers[id] === undefined) { loadBuffer(id); return true; }
    if (buffers[id] === null) { fileStop(); return false; } // не загрузился — синтез
    const rate = inten ? 1.06 : 1;
    if (fileCur && fileCur.id === id) { if (fileCur.rate !== rate) { fileCur.src.playbackRate.setTargetAtTime(rate, ac.currentTime, 0.8); fileCur.rate = rate; } return true; }
    fileStop();
    const tr = manifest.tracks[id], buf = buffers[id], src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf; src.loop = true;
    src.loopStart = Math.max(0, +tr.loop_start || 0); src.loopEnd = Math.min(buf.duration, +tr.loop_end || buf.duration);
    src.playbackRate.value = rate;
    g.gain.setValueAtTime(0, ac.currentTime); g.gain.linearRampToValueAtTime(0.55, ac.currentTime + 0.8); // файлы −16 LUFS — громче синтеза
    src.connect(g); g.connect(musicOut); src.start();
    fileCur = { id, src, gain: g, rate };
    return true;
  }
  function music(id, playing, intensity) { // каждый кадр: какой трек, играть ли, напряжение 0/1
    if (!ac || typeof Music === 'undefined') return;
    const on = playing && !muted && !document.hidden;
    if (ac.state === 'suspended' && on) ac.resume();
    let useFile = false;
    if (source === 'files') { try { useFile = fileUpdate(id, on, intensity); } catch (e) { useFile = false; } }
    else if (fileCur) fileStop();
    Music.update(ac, musicOut, id, on && !useFile, intensity);
  }
  function toggleSource() { // вернуть: что теперь выбрано и есть ли файлы
    source = source === 'synth' ? 'files' : 'synth';
    try { localStorage.setItem(SRC_KEY, source); } catch (e) {}
    return loadManifest().then(m => ({ source, files: !!m }));
  }
  function unlock() {
    if (unlocked) return; unlocked = true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 4; comp.connect(ac.destination);
      master = ac.createGain(); master.gain.value = SFX_VOL; master.connect(comp);
      musicOut = ac.createGain(); musicOut.gain.value = MUSIC_VOL; musicOut.connect(comp);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  function tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.3, freq = 1200, delay = 0, q = 0.8) {
    const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  const notes = (list, type = 'square', vol = 0.16) => list.forEach(([f, d, at]) => tone(type, f, f, d, vol, at));
  const SFX = {
    tap:     () => tone('square', 700, 700, 0.04, 0.08),
    select:  () => tone('square', 660, 660, 0.05, 0.1),
    point:   () => { tone('sine', 1760, 1760, 0.06, 0.14); tone('sine', 2350, 2350, 0.08, 0.1, 0.06); }, // «пик» тахеометра — пикет снят
    good:    () => notes([[784, 0.07, 0], [1047, 0.12, 0.07]], 'triangle', 0.2),
    bad:     () => { tone('sawtooth', 220, 110, 0.25, 0.16); },
    warn:    () => { tone('square', 880, 880, 0.08, 0.1); tone('square', 880, 880, 0.08, 0.1, 0.14); },
    station: () => { noise(0.12, 0.2, 500); tone('triangle', 330, 440, 0.12, 0.12, 0.05); }, // штатив встал
    measure: () => { for (let i = 0; i < 3; i++) tone('sine', 2000 + i * 300, 2000 + i * 300, 0.04, 0.08, i * 0.05); },
    beep:    () => tone('sine', 1400, 1400, 0.05, 0.1),
    dig:     () => { noise(0.18, 0.3, 300, 0, 0.6); noise(0.12, 0.2, 900, 0.08); },
    paper:   () => { noise(0.08, 0.13, 4200, 0, 1.2); noise(0.07, 0.1, 3000, 0.07, 1.2); },
    drop:    () => tone('sine', 900, 300, 0.15, 0.15),
    step:    () => noise(0.035, 0.06, 1500, 0, 1.2),
    splash:  () => { noise(0.3, 0.25, 1800, 0, 0.5); noise(0.2, 0.15, 600, 0.05); },
    bark:    () => { tone('sawtooth', 420, 260, 0.08, 0.16); tone('sawtooth', 420, 240, 0.09, 0.16, 0.14); },
    car:     () => { noise(0.6, 0.18, 220, 0, 0.7); tone('sawtooth', 70, 90, 0.6, 0.06); },
    wind:    () => noise(0.9, 0.12, 700, 0, 0.4),
    win:     () => notes([[523, 0.12, 0], [659, 0.12, 0.12], [784, 0.12, 0.24], [1047, 0.2, 0.36], [784, 0.12, 0.6], [1047, 0.5, 0.72]], 'square', 0.16),
    clear:   () => notes([[523, 0.1, 0], [659, 0.1, 0.1], [784, 0.1, 0.2], [1047, 0.3, 0.3]], 'square', 0.16),
  };
  const lastPlayed = {};
  function play(name) {
    if (muted || !ac || !SFX[name]) return;
    const now = performance.now(); if (now - (lastPlayed[name] || 0) < 45) return; lastPlayed[name] = now;
    if (ac.state === 'suspended') ac.resume();
    try { SFX[name](); } catch (e) {}
  }
  function toggleMute() { muted = !muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {} }
  return { play, music, unlock, toggleMute, toggleSource, get muted() { return muted; }, get source() { return source; }, get hasFiles() { return !!manifest; }, names: Object.keys(SFX) };
})();
