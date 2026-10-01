'use strict';
// Звук Level Runner: музыка (music/: свой трек у участков, меню и босса по manifest.json; запасной — «КиШ Геодезия») и синтезированные эффекты.
// Браузеры разрешают звук только после действия игрока — всё включается при первом нажатии (unlockAudio).
const Sound = (() => {
  const MUTE_KEY = 'level-runner-muted';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  let ac = null, master = null, noiseBuf = null, unlocked = false;
  const MUSIC_VOL = 0.25;  // музыка — фоном, тише эффектов
  const SFX_VOL = 0.9;     // общий уровень эффектов

  // ---------- саундтрек ----------
  // Свой трек у каждого участка, меню и боя с боссом — от локального генератора ACE-Step (music/manifest.json,
  // договор — «Музыка для игр» в CLAUDE.md). Петли бесшовные — играем через Web Audio с loopStart/loopEnd.
  // Нет трека (или манифеста, или не загрузился) — общий «КиШ Геодезия», как раньше.
  const fallback = new Audio(); fallback.src = 'music/kish-geodeziya.mp3'; fallback.loop = true; fallback.preload = 'none'; fallback.volume = MUSIC_VOL;
  const canOgg = !!fallback.canPlayType('audio/ogg; codecs="vorbis"');
  let manifest, wantPlay = false, wantId = null, cur = null, musicGain = null; const bufs = {};
  function loadManifest() {
    manifest = null; // идёт загрузка
    fetch('music/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null).then(m => {
      const map = {};
      for (const r of (m && Array.isArray(m.tracks) ? m.tracks : [])) {
        const key = r.use === 'level' ? 'L' + r.level : r.use; // L1…L10, menu, boss
        if (key && r.files) map[key] = r;
      }
      manifest = map; syncMusic();
    });
  }
  function loadBuf(key) {
    const r = manifest[key]; if (bufs[key] !== undefined) return; bufs[key] = 'loading';
    fetch('music/' + (canOgg && r.files.ogg ? r.files.ogg : r.files.mp3 || r.files.ogg)).then(x => x.arrayBuffer())
      .then(b => new Promise((ok, no) => ac.decodeAudioData(b, ok, no))).then(buf => { bufs[key] = buf; syncMusic(); }).catch(() => { bufs[key] = null; syncMusic(); });
  }
  function stopCur(fade = 0.5) {
    if (!cur) return; const c = cur; cur = null; const t = ac.currentTime;
    c.g.gain.cancelScheduledValues(t); c.g.gain.setValueAtTime(c.g.gain.value, t); c.g.gain.linearRampToValueAtTime(0, t + fade);
    try { c.s.stop(t + fade + 0.05); } catch (e) {}
  }
  function syncMusic() {
    const should = wantPlay && unlocked && !muted && !document.hidden;
    let useFile = false;
    if (ac && manifest === undefined) loadManifest();
    if (ac && manifest && wantId && manifest[wantId]) {
      const b = bufs[wantId];
      if (b === undefined) loadBuf(wantId);
      if (b !== null) useFile = true; // грузится или готов — общий трек не включаем
      if (b && b !== 'loading' && should) {
        if (!cur || cur.id !== wantId) {
          stopCur(); if (ac.state === 'suspended') ac.resume();
          const r = manifest[wantId], s = ac.createBufferSource(), g = ac.createGain();
          s.buffer = b; s.loop = true; s.loopStart = Math.max(0, +r.loop_start_s || 0); s.loopEnd = Math.min(b.duration, +r.loop_end_s || b.duration);
          g.gain.setValueAtTime(0, ac.currentTime); g.gain.linearRampToValueAtTime(1, ac.currentTime + 0.6);
          s.connect(g); g.connect(musicGain); s.start(); cur = { id: wantId, s, g };
        }
      } else stopCur(0.25);
    } else stopCur();
    const fb = should && !useFile && !(ac && manifest === null); // пока манифест грузится — тишина, без «КиШ» на секунду
    if (fb && fallback.paused) fallback.play().catch(() => {});
    if (!fb && !fallback.paused) fallback.pause();
  }
  let lastKey = '';
  function music(level, playing, where) { // вызывается движком каждый кадр: участок, играть ли, { menu, boss }
    wantId = where && where.menu ? 'menu' : where && where.boss ? 'boss' : 'L' + (level + 1);
    if (manifest && wantId === 'boss' && !manifest.boss) wantId = 'L' + (level + 1);
    wantPlay = playing;
    const k = wantId + (wantPlay ? 1 : 0) + (muted ? 1 : 0) + (manifest ? 1 : 0); // без лишней работы каждый кадр
    if (k !== lastKey) { lastKey = k; syncMusic(); }
  }
  document.addEventListener('visibilitychange', () => { lastKey = ''; syncMusic(); }); // свернули вкладку/Telegram — музыка на паузе

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // эффекты громкие, поэтому идут через компрессор — при наложении не хрипят
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 4; comp.connect(ac.destination);
      master = ac.createGain(); master.gain.value = SFX_VOL; master.connect(comp);
      musicGain = ac.createGain(); musicGain.gain.value = MUSIC_VOL; musicGain.connect(ac.destination); // музыка мимо компрессора, как раньше <audio>
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
    // шаги, лестница, приземление
    step:     () => noise(0.035, 0.07, 1500, 0, 1.2),
    stepSnow: () => { noise(0.07, 0.11, 3200, 0, 0.5); noise(0.05, 0.06, 900, 0.02, 1); }, // хруст снега
    ladder:   () => tone('triangle', 1250, 1100, 0.05, 0.1),
    land:     () => { noise(0.09, 0.2, 260, 0, 0.8); tone('sine', 120, 60, 0.08, 0.15); },
    stomp:    () => { tone('sine', 180, 520, 0.14, 0.25); noise(0.06, 0.15, 700); }, // прыжок на голову — «боинг»
    throw:    () => noise(0.14, 0.09, 1100, 0, 2.2),                                 // враг что-то кинул — свист
    // каски, чертежи, тайники
    helmet:   () => notes([[660, 0.07, 0], [880, 0.07, 0.07], [1320, 0.16, 0.14]], 'triangle', 0.24),
    gold:     () => notes([[1320, 0.05, 0], [1760, 0.05, 0.05], [2093, 0.05, 0.1], [2637, 0.18, 0.15]], 'square', 0.1),
    secret:   () => notes([[392, 0.09, 0], [494, 0.09, 0.09], [587, 0.09, 0.18], [784, 0.09, 0.27], [988, 0.09, 0.36], [1175, 0.35, 0.45]], 'triangle', 0.22),
    crack:    () => { noise(0.08, 0.3, 2200, 0, 1.4); tone('square', 320, 180, 0.07, 0.12); },
    break:    () => { noise(0.1, 0.35, 900); noise(0.08, 0.28, 1500, 0.06); noise(0.12, 0.22, 600, 0.12); tone('square', 200, 90, 0.12, 0.12); }, // ящик — треск досок
    barrel:   () => { tone('triangle', 430, 360, 0.3, 0.25); tone('triangle', 610, 560, 0.2, 0.12); noise(0.25, 0.25, 500); }, // бочка — жестяной грохот
    rubble:   () => { noise(0.5, 0.4, 300, 0, 0.6); noise(0.3, 0.25, 1400, 0.05); tone('sine', 110, 45, 0.35, 0.25); }, // обвал кладки
    bossDrop: () => tone('square', 280, 960, 0.18, 0.16),
    vanish:   () => tone('sine', 900, 300, 0.2, 0.12),
    intro:    () => notes([[392, 0.08, 0], [523, 0.08, 0.09], [659, 0.18, 0.18]], 'square', 0.13),
    // геодезист-халтурщик с GPS на вешке
    gps:      () => { tone('sine', 1900, 1900, 0.05, 0.14); tone('sine', 1900, 1900, 0.05, 0.14, 0.09); },
    swingPole: () => { noise(0.16, 0.2, 1500, 0, 1.2); tone('triangle', 500, 380, 0.08, 0.06); }, // вешка с прибором — «тяжелее» рейки
    snowFall:  () => { noise(0.25, 0.22, 2600, 0, 0.5); noise(0.2, 0.12, 700, 0.05, 0.8); },
    paper:     () => { noise(0.08, 0.13, 4200, 0, 1.2); noise(0.07, 0.1, 3000, 0.07, 1.2); }, // шелест бумаг
    thump:     () => { noise(0.08, 0.25, 350, 0, 0.8); tone('sine', 140, 80, 0.07, 0.12); },          // удар по мешку, картону, пластику
    bag:       () => { noise(0.3, 0.3, 500, 0, 0.5); noise(0.25, 0.15, 1800, 0.04, 0.6); },      // мешок лопнул — облако пыли
    pop:       () => { tone('square', 700, 200, 0.08, 0.15); noise(0.1, 0.2, 1200); },            // конусы разлетелись
    clink:     () => { tone('triangle', 2400, 2200, 0.06, 0.12); tone('triangle', 3100, 3000, 0.05, 0.07, 0.02); }, // по стеклу и льду
    glass:     () => { noise(0.35, 0.3, 5000, 0, 0.9); for (let i = 0; i < 5; i++) tone('triangle', 2000 + i * 430, 1800 + i * 400, 0.08, 0.07, i * 0.035); }, // звон стекла
    treasure: () => notes([[523, 0.08, 0], [659, 0.08, 0.08], [784, 0.08, 0.16], [1047, 0.08, 0.24], [1319, 0.3, 0.32]], 'square', 0.16),
    relic:    () => { notes([[392, 0.12, 0], [523, 0.12, 0.12], [659, 0.12, 0.24], [784, 0.12, 0.36], [1047, 0.5, 0.48]], 'triangle', 0.24); notes([[784, 0.5, 0.48], [1319, 0.5, 0.48]], 'square', 0.08); },
    shout:    () => { for (let i = 0; i < 4; i++) tone('sawtooth', 300 + (i % 2) * 90 + Math.random() * 40, 220, 0.07, 0.1, i * 0.08); }, // «бу-бу-бу!» — ругань
    whack:    () => { noise(0.12, 0.4, 900, 0, 0.7); tone('square', 420, 160, 0.1, 0.18); },  // рулоном чертежей по каске
    snore:    () => { noise(0.6, 0.12, 180, 0, 2); tone('sawtooth', 70, 55, 0.5, 0.05); }, // храп
    creak:    () => { tone('sawtooth', 180, 120, 0.35, 0.08); tone('sawtooth', 240, 170, 0.25, 0.05, 0.12); }, // скрип досок
    collapse: () => { noise(0.4, 0.35, 700, 0, 0.7); noise(0.3, 0.25, 1600, 0.08); tone('triangle', 300, 120, 0.3, 0.12); },
    roar:     () => { noise(0.5, 0.35, 260, 0, 0.6); tone('sawtooth', 140, 70, 0.5, 0.18); },  // рык из сугроба
    tape:     () => { for (let i = 0; i < 6; i++) tone('square', 1800 - i * 120, 1700 - i * 120, 0.02, 0.06, i * 0.025); }, // треск рулетки
    cash:     () => notes([[1047, 0.05, 0], [784, 0.05, 0.06], [523, 0.12, 0.12]], 'square', 0.14), // «минус деньги»
    atr:      () => { tone('sine', 1500, 1500, 0.06, 0.1); tone('sine', 1500, 1500, 0.06, 0.1, 0.12); tone('sine', 2000, 2000, 0.12, 0.1, 0.24); },
    zap:      () => { noise(0.25, 0.35, 3000, 0, 0.8); tone('sawtooth', 900, 120, 0.25, 0.15); },
    laugh:    () => notes([[560, 0.06, 0], [470, 0.06, 0.09], [560, 0.06, 0.18], [470, 0.09, 0.27]], 'square', 0.12),
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
    play, music, unlock, toggleMute, get muted() { return muted; }, get musicNow() { return cur ? cur.id : !fallback.paused ? 'КиШ' : null; },
    get state() { return current ? { track: current.src.split('/').pop(), playing: !current.paused, time: +current.currentTime.toFixed(1) } : null; }, // для проверок
  };
})();
