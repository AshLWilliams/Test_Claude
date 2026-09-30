'use strict';
// Звук Level Runner: саундтрек (два трека из music/) и синтезированные эффекты (Web Audio, без файлов).
// Браузеры разрешают звук только после действия игрока — всё включается при первом нажатии (unlockAudio).
const Sound = (() => {
  const MUTE_KEY = 'level-runner-muted';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  let ac = null, master = null, noiseBuf = null, unlocked = false;
  const MUSIC_VOL = 0.25;  // музыка — фоном, тише эффектов
  const SFX_VOL = 0.9;     // общий уровень эффектов

  // ---------- саундтрек: участки 1–5 и меню — трек 1, участки 6–10 — трек 2 ----------
  const tracks = ['music/track1.mp3', 'music/track2.mp3'].map(src => {
    const a = new Audio(); a.src = src; a.loop = true; a.preload = 'none'; a.volume = MUSIC_VOL;
    return a;
  });
  let current = null, wantPlay = false;
  function trackFor(level) { return tracks[level >= 5 ? 1 : 0]; }
  function syncMusic() {
    for (const t of tracks) if (t !== current && !t.paused) t.pause();
    if (!current) return;
    const should = wantPlay && unlocked && !muted && !document.hidden;
    if (should && current.paused) current.play().catch(() => {});
    if (!should && !current.paused) current.pause();
  }
  function music(level, playing) { // вызывается движком при смене участка и режима
    const t = trackFor(level);
    if (t !== current) { if (current) current.pause(); current = t; }
    wantPlay = playing;
    syncMusic();
  }
  document.addEventListener('visibilitychange', syncMusic); // свернули вкладку/Telegram — музыка на паузе

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // эффекты громкие, поэтому идут через компрессор — при наложении не хрипят
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 4; comp.connect(ac.destination);
      master = ac.createGain(); master.gain.value = SFX_VOL; master.connect(comp);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
    syncMusic();
  }

  // ---------- синтез ----------
  function tone(type, f0, f1, dur, vol = 0.3, delay = 0) { // тон со сдвигом частоты f0 → f1
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.3, freq = 1200, delay = 0, q = 0.8) { // шум через полосовой фильтр
    const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  const notes = (list, type = 'square', vol = 0.18) => list.forEach(([f, d, at]) => tone(type, f, f, d, vol, at));

  const SFX = {
    jump:     () => tone('square', 260, 520, 0.12, 0.12),
    swing:    () => noise(0.12, 0.18, 2400, 0, 1.5),
    hit:      () => { tone('square', 220, 90, 0.08, 0.22); noise(0.06, 0.2, 900); },
    kill:     () => { tone('square', 520, 120, 0.18, 0.2); noise(0.18, 0.2, 600); },
    clang:    () => { tone('triangle', 1400, 1200, 0.12, 0.2); tone('square', 900, 850, 0.08, 0.1); }, // удар по броне
    hurt:     () => { tone('sawtooth', 300, 70, 0.3, 0.25); noise(0.2, 0.2, 400); },
    fall:     () => tone('triangle', 600, 60, 0.6, 0.25),
    pickup:   () => notes([[880, 0.06, 0], [1320, 0.1, 0.06]], 'square', 0.12),
    checkpoint: () => notes([[523, 0.08, 0], [659, 0.08, 0.08], [784, 0.14, 0.16]], 'triangle', 0.22),
    reflect:  () => { tone('square', 700, 1600, 0.12, 0.15); noise(0.05, 0.2, 3000); },
    smash:    () => noise(0.12, 0.2, 1500),
    thud:     () => { noise(0.35, 0.4, 120, 0, 0.6); tone('sine', 80, 40, 0.3, 0.3); },
    boss:     () => { tone('sawtooth', 110, 55, 0.9, 0.3); noise(0.8, 0.25, 200); },
    bossHit:  () => { tone('square', 160, 60, 0.2, 0.3); noise(0.15, 0.3, 500); },
    explosion: () => { noise(0.9, 0.45, 150, 0, 0.5); tone('sine', 90, 30, 0.8, 0.35); },
    clear:    () => notes([[523, 0.1, 0], [659, 0.1, 0.1], [784, 0.1, 0.2], [1047, 0.3, 0.3]], 'square', 0.16),
    win:      () => notes([[523, 0.12, 0], [659, 0.12, 0.12], [784, 0.12, 0.24], [1047, 0.2, 0.36], [784, 0.12, 0.6], [1047, 0.5, 0.72]], 'square', 0.16),
    over:     () => notes([[392, 0.2, 0], [330, 0.2, 0.22], [262, 0.5, 0.44]], 'triangle', 0.22),
    select:   () => tone('square', 660, 660, 0.05, 0.1),
  };
  const lastPlayed = {};
  function play(name) {
    if (muted || !ac || !SFX[name]) return;
    const now = performance.now();
    if (now - (lastPlayed[name] || 0) < 45) return; // один и тот же звук не чаще ~20 раз в секунду
    lastPlayed[name] = now;
    if (ac.state === 'suspended') ac.resume();
    try { SFX[name](); } catch (e) {}
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
    syncMusic();
  }

  return {
    play, music, unlock, toggleMute, get muted() { return muted; },
    get state() { return current ? { track: current.src.split('/').pop(), playing: !current.paused, time: +current.currentTime.toFixed(1) } : null; }, // для проверок
  };
})();
