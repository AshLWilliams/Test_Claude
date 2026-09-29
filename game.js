'use strict';
// Star Dodger — уворачивайся от астероидов, собирай кристаллы.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

const rand = (a, b) => a + Math.random() * (b - a);
const STORAGE_KEY = 'star-dodger-best';
let best = 0;
try { best = +localStorage.getItem(STORAGE_KEY) || 0; } catch (e) {}

// Звёздный фон (3 слоя параллакса)
const stars = Array.from({ length: 90 }, () => ({
  x: rand(0, W), y: rand(0, H), z: rand(0.3, 1.5),
}));

let state, ship, rocks, gems, particles, score, lives, time, spawnT, gemT, shake, invuln;
let mode = 'menu'; // menu | play | pause | over
const keys = {};
let targetX = null;

function reset() {
  ship = { x: W / 2, y: H - 70, w: 34, h: 40, vx: 0 };
  rocks = []; gems = []; particles = [];
  score = 0; lives = 3; time = 0; spawnT = 0; gemT = 2; shake = 0; invuln = 0;
}
reset();

function makeRock() {
  const r = rand(14, 34);
  const pts = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2, d = r * rand(0.75, 1.15);
    return [Math.cos(a) * d, Math.sin(a) * d];
  });
  rocks.push({ x: rand(r, W - r), y: -r, r, pts, vy: rand(110, 190) + time * 4, rot: 0, vr: rand(-2, 2) });
}

function burst(x, y, color, n = 16) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, 240);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), max: 0.8, color });
  }
}

function update(dt) {
  for (const s of stars) { s.y += 30 * s.z * dt * (mode === 'play' ? 1 + time / 60 : 1); if (s.y > H) { s.y = 0; s.x = rand(0, W); } }
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  shake = Math.max(0, shake - dt * 20);
  if (mode !== 'play') return;

  time += dt; invuln = Math.max(0, invuln - dt);
  // управление
  const dir = (keys.ArrowRight || keys.d || keys.D ? 1 : 0) - (keys.ArrowLeft || keys.a || keys.A ? 1 : 0);
  if (dir) { targetX = null; ship.vx += dir * 2600 * dt; }
  else if (targetX !== null) ship.vx += Math.max(-1, Math.min(1, (targetX - ship.x) / 40)) * 2600 * dt;
  ship.vx *= Math.pow(0.0008, dt);
  ship.x = Math.max(ship.w / 2, Math.min(W - ship.w / 2, ship.x + ship.vx * dt));
  // огонь двигателя
  if (Math.random() < 0.7) particles.push({ x: ship.x + rand(-4, 4), y: ship.y + ship.h / 2, vx: rand(-20, 20), vy: rand(80, 160), life: 0.3, max: 0.8, color: '#ff9a3c' });

  spawnT -= dt;
  if (spawnT <= 0) { makeRock(); spawnT = Math.max(0.22, 0.85 - time * 0.012); }
  gemT -= dt;
  if (gemT <= 0) { gems.push({ x: rand(20, W - 20), y: -12, vy: 130, t: 0 }); gemT = rand(1.5, 3.2); }

  for (const r of rocks) {
    r.y += r.vy * dt; r.rot += r.vr * dt;
    if (invuln <= 0 && Math.hypot(r.x - ship.x, r.y - ship.y) < r.r * 0.85 + 14) {
      r.dead = true; lives--; invuln = 1.5; shake = 10;
      burst(ship.x, ship.y, '#ff5d5d', 26); burst(r.x, r.y, '#b9a99a', 14);
      if (lives <= 0) gameOver();
    }
  }
  rocks = rocks.filter(r => !r.dead && r.y < H + 50);

  for (const g of gems) {
    g.y += g.vy * dt; g.t += dt;
    if (Math.hypot(g.x - ship.x, g.y - ship.y) < 26) { g.dead = true; score += 10; burst(g.x, g.y, '#5ff0ff', 12); }
  }
  gems = gems.filter(g => !g.dead && g.y < H + 20);
  score += dt * 2; // очки за выживание
}

function gameOver() {
  mode = 'over';
  burst(ship.x, ship.y, '#ffd76a', 60);
  if (Math.floor(score) > best) {
    best = Math.floor(score);
    try { localStorage.setItem(STORAGE_KEY, best); } catch (e) {}
  }
}

function drawShip() {
  if (mode === 'over') return;
  if (invuln > 0 && Math.floor(invuln * 12) % 2) return; // мигание
  ctx.save(); ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.vx / 2500);
  ctx.fillStyle = '#ffd76a'; ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -ship.h / 2); ctx.lineTo(ship.w / 2, ship.h / 2); ctx.lineTo(0, ship.h / 4); ctx.lineTo(-ship.w / 2, ship.h / 2); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#5ff0ff'; ctx.beginPath(); ctx.arc(0, 2, 5, 0, 7); ctx.fill();
  ctx.restore();
}

function drawGem(g) {
  ctx.save(); ctx.translate(g.x, g.y); ctx.scale(Math.cos(g.t * 4) * 0.5 + 0.8, 1);
  ctx.fillStyle = '#5ff0ff'; ctx.shadowColor = '#5ff0ff'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 0); ctx.lineTo(0, 11); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function text(str, x, y, size, color = '#fff', align = 'center') {
  ctx.fillStyle = color; ctx.font = `bold ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.fillText(str, x, y);
}

function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  ctx.fillStyle = '#0a0d24'; ctx.fillRect(-20, -20, W + 40, H + 40);
  for (const s of stars) { ctx.fillStyle = `rgba(200,215,255,${0.3 + s.z * 0.4})`; ctx.fillRect(s.x, s.y, s.z * 1.8, s.z * 1.8); }
  for (const g of gems) drawGem(g);
  for (const r of rocks) {
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
    ctx.fillStyle = '#5b5568'; ctx.strokeStyle = '#a79fb8'; ctx.lineWidth = 2;
    ctx.beginPath(); r.pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  drawShip();
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
  ctx.globalAlpha = 1;
  ctx.restore();

  // HUD
  text('Очки: ' + Math.floor(score), 14, 28, 18, '#fff', 'left');
  text('Рекорд: ' + best, W - 14, 28, 14, '#9aa5e0', 'right');
  text('♥'.repeat(Math.max(0, lives)), 14, 52, 20, '#ff5d7a', 'left');

  if (mode === 'menu') overlay('STAR DODGER', 'Уворачивайся от астероидов,\nсобирай кристаллы', 'Нажми пробел или тапни, чтобы начать');
  if (mode === 'pause') overlay('ПАУЗА', '', 'Пробел — продолжить');
  if (mode === 'over') overlay('КОНЕЦ ИГРЫ', `Очки: ${Math.floor(score)}   Рекорд: ${best}`, 'Пробел или тап — играть снова');
}

function overlay(title, sub, hint) {
  ctx.fillStyle = 'rgba(5,6,15,.72)'; ctx.fillRect(0, 0, W, H);
  text(title, W / 2, H / 2 - 50, 40, '#ffd76a');
  sub.split('\n').forEach((l, i) => text(l, W / 2, H / 2 + i * 26, 18, '#cfd8ff'));
  text(hint, W / 2, H / 2 + 90, 15, '#9aa5e0');
}

function startOrToggle() {
  if (mode === 'menu') mode = 'play';
  else if (mode === 'play') mode = 'pause';
  else if (mode === 'pause') mode = 'play';
  else if (mode === 'over') { reset(); mode = 'play'; }
}

addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startOrToggle(); return; }
  keys[e.key] = true;
});
addEventListener('keyup', e => { keys[e.key] = false; });
function pointer(e) {
  const rect = canvas.getBoundingClientRect();
  targetX = (e.clientX - rect.left) * (W / rect.width);
}
canvas.addEventListener('pointermove', pointer);
canvas.addEventListener('pointerdown', e => { pointer(e); if (mode !== 'play') startOrToggle(); });
addEventListener('blur', () => { if (mode === 'play') mode = 'pause'; });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
