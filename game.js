const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const healthBar = document.querySelector("#playerHealthBar");
const healthText = document.querySelector("#playerHealthText");
const timeLabel = document.querySelector("#time");
const aiCountLabel = document.querySelector("#aiCount");
const catchCountLabel = document.querySelector("#catchCount");
const killCountLabel = document.querySelector("#killCount");
const phaseLabel = document.querySelector("#phase-label");
const connection = document.querySelector(".connection");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const restartButton = document.querySelector("#restartButton");
const fireButton = document.querySelector("#fireButton");
const soundToggle = document.querySelector("#soundToggle");
const soundLabel = document.querySelector("#soundLabel");
const levelupDialog = document.querySelector("#levelupDialog");

const BALL_RADIUS = 12;
const BULLET_RADIUS = 6;
const PLAYER_SPEED = 3;
const AI_SPEED = 1.5;
const PLAYER_MAX_HEALTH = 100;
const AI_BASE_HEALTH = 20;
const AI_HEALTH_INTERVAL = 30;
const AI_HEALTH_INCREASE = 5;
const COLLIDE_DAMAGE = 15;
const BULLET_DAMAGE = 5;
const ENEMY_BULLET_DAMAGE = 3;
const BULLET_BASE_SPEED = 1.8;
const BULLET_SPEED_PER_UPGRADE = 0.2;
const SHOT_INTERVAL_MS = 500;
const AI_RESPAWN_DELAY = 1000;
const ADD_AI_INTERVAL = 15;
const FRAME_UNIT = 1000 / 60;

const keys = new Set();
let phase = "ready";
let previousFrame = 0;
let lastShotAt = 0;
let gameState;
let audioContext = null;
let soundMuted = false;

function getAiMaxHealth() {
  return AI_BASE_HEALTH + Math.floor(gameState.surviveTime / AI_HEALTH_INTERVAL) * AI_HEALTH_INCREASE;
}

function getBulletSpeed() {
  return BULLET_BASE_SPEED + gameState.bonusBulletSpeed;
}

function getBulletDamage() {
  const damage = BULLET_DAMAGE + gameState.bonusDamage;
  return gameState.multishotDamagePenalty ? damage * 0.8 : damage;
}

function ensureAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return;
  if (!audioContext) audioContext = new AudioContextConstructor();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}

function playSound(name) {
  if (soundMuted || !audioContext) return;
  const sounds = {
    hit: { type: "triangle", start: 700, end: 430, duration: .08, volume: .045 },
    kill: { type: "square", start: 360, end: 920, duration: .2, volume: .055 },
    death: { type: "sawtooth", start: 300, end: 55, duration: .48, volume: .075 }
  };
  const sound = sounds[name];
  if (!sound) return;

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = sound.type;
  oscillator.frequency.setValueAtTime(sound.start, now);
  oscillator.frequency.exponentialRampToValueAtTime(sound.end, now + sound.duration);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(sound.volume, now + .01);
  gain.gain.exponentialRampToValueAtTime(.0001, now + sound.duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + sound.duration);
}

function createAi(index, isShooter = false) {
  const spawn = {
    x: canvas.width - 150,
    y: Math.round(canvas.height * (index + 1) / (isShooter ? 3 : 6))
  };
  return {
    x: spawn.x,
    y: spawn.y,
    spawn,
    radius: BALL_RADIUS,
    speed: AI_SPEED,
    health: getAiMaxHealth(),
    isShooter,
    nextShotAt: isShooter ? performance.now() + 900 : 0,
    alive: true,
    respawnAt: 0
  };
}

function resetGame() {
  keys.clear();
  gameState = {
    player: {
      x: 150,
      y: canvas.height / 2,
      radius: BALL_RADIUS,
      speed: PLAYER_SPEED,
      health: PLAYER_MAX_HEALTH,
      direction: { x: 1, y: 0 }
    },
    aiList: [],
    regularAiCount: 1,
    bullets: [],
    enemyBullets: [],
    surviveTime: 0,
    elapsedMs: 0,
    catchCount: 0,
    killCount: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: 5,
    bonusDamage: 0,
    bonusBulletSpeed: 0,
    bulletCount: 1,
    multishotDamagePenalty: false
  };
  levelupDialog.hidden = true;
  gameState.aiList.push(createAi(0));
  lastShotAt = 0;
  setPhase("ready");
  updateHud();
  draw();
}

function setPhase(nextPhase) {
  phase = nextPhase;
  connection.dataset.phase = nextPhase;
  phaseLabel.textContent = {
    ready: "待命中",
    playing: "任务进行中",
    paused: "已暂停",
    levelup: "选择升级",
    over: "任务结束"
  }[nextPhase];
  startButton.disabled = nextPhase === "playing" || nextPhase === "levelup";
  startButton.querySelector("span").textContent = nextPhase === "over" ? "↻" : "↗";
  startButton.firstChild.textContent = {
    ready: "开始任务 ",
    playing: "任务进行中 ",
    paused: "继续任务 ",
    levelup: "升级中 ",
    over: "再试一次 "
  }[nextPhase];
  pauseButton.disabled = nextPhase !== "playing" && nextPhase !== "paused";
  pauseButton.textContent = nextPhase === "paused" ? "继续" : "暂停";
  if (nextPhase === "ready" || nextPhase === "paused" || nextPhase === "over") draw();
}

function startGame() {
  if (phase === "levelup") return;
  if (phase === "over") resetGame();
  ensureAudioContext();
  setPhase("playing");
  previousFrame = 0;
}

function togglePause() {
  if (phase === "playing") setPhase("paused");
  else if (phase === "paused") startGame();
}

function updateHud() {
  healthBar.style.width = `${gameState.player.health}%`;
  healthBar.style.backgroundColor = gameState.player.health <= 30 ? "#fa654f" : "#7acb83";
  healthText.innerHTML = `${gameState.player.health} <small>/ ${PLAYER_MAX_HEALTH}</small>`;
  timeLabel.textContent = gameState.surviveTime;
  aiCountLabel.textContent = gameState.aiList.length;
  catchCountLabel.textContent = gameState.catchCount;
  killCountLabel.textContent = gameState.killCount;
  document.querySelector("#red-health").textContent = getAiMaxHealth();
  document.querySelector("#shooter-count").textContent = gameState.aiList.filter((ai) => ai.isShooter).length;
  document.querySelector("#threat-level").textContent = gameState.aiList.length > 3 ? "HIGH" : gameState.aiList.length > 1 ? "MED" : "LOW";
  document.querySelector("#player-level").textContent = gameState.level;
  document.querySelector("#experience").textContent = gameState.experience;
  document.querySelector("#experience-needed").textContent = gameState.experienceToNextLevel;
  document.querySelector("#experienceBar").style.width = `${gameState.experience / gameState.experienceToNextLevel * 100}%`;
}

function getDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function getNearestAi(point) {
  let nearestAi = null;
  let nearestDistance = Infinity;
  gameState.aiList.forEach((ai) => {
    if (!ai.alive) return;
    const distance = getDistance(point, ai);
    if (distance < nearestDistance) {
      nearestAi = ai;
      nearestDistance = distance;
    }
  });
  return nearestAi;
}

function fireBullet() {
  if (phase !== "playing") return;
  const now = performance.now();
  if (now - lastShotAt < SHOT_INTERVAL_MS) return;
  lastShotAt = now;
  const direction = gameState.player.direction;
  const baseAngle = Math.atan2(direction.y, direction.x);
  const spread = Math.PI / 12;
  const target = getNearestAi(gameState.player);
  for (let bulletIndex = 0; bulletIndex < gameState.bulletCount; bulletIndex += 1) {
    const offset = (bulletIndex - (gameState.bulletCount - 1) / 2) * spread;
    const angle = baseAngle + offset;
    gameState.bullets.push({
      x: gameState.player.x,
      y: gameState.player.y,
      radius: BULLET_RADIUS,
      speed: getBulletSpeed(),
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      target
    });
  }
}

function updatePlayer(frameScale) {
  const player = gameState.player;
  let moveX = 0;
  let moveY = 0;
  if (keys.has("ArrowUp")) moveY -= 1;
  if (keys.has("ArrowDown")) moveY += 1;
  if (keys.has("ArrowLeft")) moveX -= 1;
  if (keys.has("ArrowRight")) moveX += 1;

  if (moveX || moveY) {
    if (moveX) player.direction = { x: Math.sign(moveX), y: 0 };
    else player.direction = { x: 0, y: Math.sign(moveY) };
    player.x += moveX * player.speed * frameScale;
    player.y += moveY * player.speed * frameScale;
    player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x));
    player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y));
  }
}

function updateAi(now, frameScale) {
  const player = gameState.player;
  gameState.aiList.forEach((ai) => {
    if (!ai.alive) {
      if (now >= ai.respawnAt) {
        ai.health = getAiMaxHealth();
        ai.x = ai.spawn.x;
        ai.y = ai.spawn.y;
        ai.alive = true;
      }
      return;
    }

    const dx = player.x - ai.x;
    const dy = player.y - ai.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      ai.x += dx / distance * ai.speed * frameScale;
      ai.y += dy / distance * ai.speed * frameScale;
    }
    if (ai.isShooter && now >= ai.nextShotAt) {
      const aimX = player.x - ai.x;
      const aimY = player.y - ai.y;
      const aimDistance = Math.hypot(aimX, aimY);
      if (aimDistance > 0) {
        gameState.enemyBullets.push({
          x: ai.x,
          y: ai.y,
          radius: 5,
          speed: 2.8,
          dx: aimX / aimDistance,
          dy: aimY / aimDistance
        });
      }
      ai.nextShotAt = now + 1500;
    }
  });
}

function defeatAi(ai, now) {
  ai.health = 0;
  ai.alive = false;
  ai.respawnAt = now + AI_RESPAWN_DELAY;
  gameState.killCount += 1;
  playSound("kill");
  if (gameState.killCount === 30 || gameState.killCount === 50) {
    const shooterCount = gameState.aiList.filter((enemy) => enemy.isShooter).length;
    gameState.aiList.push(createAi(shooterCount, true));
  }
  gameState.experience += 1;
  if (gameState.experience >= gameState.experienceToNextLevel) {
    gameState.experience -= gameState.experienceToNextLevel;
    gameState.level += 1;
    gameState.experienceToNextLevel += 1;
    document.querySelector("#upgrade-level").textContent = gameState.level;
    levelupDialog.hidden = false;
    setPhase("levelup");
  }
  updateHud();
}

function updateBullets(now, frameScale) {
  for (let index = gameState.bullets.length - 1; index >= 0; index -= 1) {
    const bullet = gameState.bullets[index];
    const target = bullet.target;
    if (target?.alive) {
      const dx = target.x - bullet.x;
      const dy = target.y - bullet.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0) {
        bullet.dx = dx / distance;
        bullet.dy = dy / distance;
      }
    }
    bullet.x += bullet.dx * bullet.speed * frameScale;
    bullet.y += bullet.dy * bullet.speed * frameScale;
    if (bullet.x < 0 || bullet.x > canvas.width || bullet.y < 0 || bullet.y > canvas.height) {
      gameState.bullets.splice(index, 1);
      continue;
    }

    for (const ai of gameState.aiList) {
      if (!ai.alive || getDistance(bullet, ai) >= bullet.radius + ai.radius) continue;
      ai.health = Math.max(0, ai.health - getBulletDamage());
      playSound("hit");
      if (ai.health === 0) defeatAi(ai, now);
      gameState.bullets.splice(index, 1);
      break;
    }
    if (phase === "levelup") break;
  }
}

function updateEnemyBullets(frameScale) {
  const player = gameState.player;
  for (let index = gameState.enemyBullets.length - 1; index >= 0; index -= 1) {
    const bullet = gameState.enemyBullets[index];
    bullet.x += bullet.dx * bullet.speed * frameScale;
    bullet.y += bullet.dy * bullet.speed * frameScale;
    if (bullet.x < 0 || bullet.x > canvas.width || bullet.y < 0 || bullet.y > canvas.height) {
      gameState.enemyBullets.splice(index, 1);
      continue;
    }
    if (getDistance(bullet, player) >= bullet.radius + player.radius) continue;

    player.health = Math.max(0, player.health - ENEMY_BULLET_DAMAGE);
    playSound("hit");
    gameState.enemyBullets.splice(index, 1);
    updateHud();
    if (player.health === 0) {
      setPhase("over");
      playSound("death");
      return;
    }
  }
}

function checkCollisions(now) {
  const player = gameState.player;
  gameState.aiList.forEach((ai) => {
    if (!ai.alive || getDistance(player, ai) >= player.radius + ai.radius) return;
    gameState.catchCount += 1;
    player.health = Math.max(0, player.health - COLLIDE_DAMAGE);
    ai.health = Math.max(0, ai.health - COLLIDE_DAMAGE);
    ai.alive = false;
    ai.respawnAt = now + AI_RESPAWN_DELAY;
    updateHud();
  });

  if (player.health === 0) {
    setPhase("over");
    playSound("death");
    updateHud();
  }
}

function updateSurvivalTime(delta) {
  gameState.elapsedMs += delta;
  while (gameState.elapsedMs >= 1000) {
    gameState.elapsedMs -= 1000;
    gameState.surviveTime += 1;
    if (gameState.surviveTime % AI_HEALTH_INTERVAL === 0) {
      gameState.aiList.forEach((ai) => {
        if (ai.alive) ai.health += AI_HEALTH_INCREASE;
      });
    }
    const targetCount = Math.min(1 + Math.floor(gameState.surviveTime / ADD_AI_INTERVAL), 5);
    while (gameState.regularAiCount < targetCount) {
      gameState.aiList.push(createAi(gameState.regularAiCount));
      gameState.regularAiCount += 1;
    }
    updateHud();
  }
}

function update(now, delta) {
  const frameScale = delta / FRAME_UNIT;
  updatePlayer(frameScale);
  updateAi(now, frameScale);
  updateBullets(now, frameScale);
  if (phase !== "playing") return;
  updateEnemyBullets(frameScale);
  if (phase !== "playing") return;
  checkCollisions(now);
  updateSurvivalTime(delta);
}

function drawCircle(x, y, radius, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawStar(x, y, radius) {
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const distance = point % 2 === 0 ? radius : radius * .46;
    const px = x + Math.cos(angle) * distance;
    const py = y + Math.sin(angle) * distance;
    if (point === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawPlayer() {
  const player = gameState.player;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(Math.atan2(player.direction.y, player.direction.x));
  ctx.shadowColor = "#d7f36b";
  ctx.shadowBlur = 18;
  drawCircle(0, 0, player.radius + 3, "#d7f36b");
  ctx.shadowBlur = 0;
  drawCircle(0, 0, player.radius, "#162a42", "#f5f7ed", 1.5);
  ctx.fillStyle = "#315f91";
  ctx.fillRect(-8, -8, 12, 16);
  drawCircle(5, 0, 5.5, "#e9c39f", "#152238", 1);
  ctx.beginPath();
  ctx.ellipse(5, -4, 6.5, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#234b78";
  ctx.fill();
  ctx.strokeStyle = "#a8c8ed";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#d7f36b";
  drawStar(-4, 0, 3.4);
  drawCircle(7, -2, 1, "#172522");
  drawCircle(7, 2, 1, "#172522");
  ctx.restore();
}

function drawAi(ai, now) {
  if (!ai.alive) {
    const opacity = .25 + .2 * Math.sin(now / 110);
    drawCircle(ai.spawn.x, ai.spawn.y, ai.radius, `rgba(250, 101, 79, ${opacity})`);
    return;
  }

  ctx.save();
  const directionX = gameState.player.x - ai.x;
  const directionY = gameState.player.y - ai.y;
  ctx.translate(ai.x, ai.y);
  ctx.rotate(Math.atan2(directionY, directionX));
  ctx.shadowColor = "#fa654f99";
  ctx.shadowBlur = 14;
  const gradient = ctx.createRadialGradient(-4, -5, 1, 0, 0, ai.radius + 3);
  gradient.addColorStop(0, "#ff9a78");
  gradient.addColorStop(1, "#d83236");
  drawCircle(0, 0, ai.radius, gradient, "#ffb09b99");
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#252328";
  ctx.fillRect(-9, -3, 16, 6);
  drawCircle(-5, -1, 1.15, "#fff0d7");
  drawCircle(1, -1, 1.15, "#fff0d7");
  ctx.beginPath();
  ctx.ellipse(-1, -6, 7, 3.5, 0, Math.PI, Math.PI * 2);
  ctx.fillStyle = "#252328";
  ctx.fill();
  if (ai.isShooter) {
    ctx.fillStyle = "#f2b84b";
    ctx.fillRect(6, -2, 12, 4);
    ctx.fillRect(8, 2, 4, 5);
  }
  ctx.restore();

  const barWidth = 28;
  ctx.fillStyle = "#263238";
  ctx.fillRect(ai.x - barWidth / 2, ai.y - 22, barWidth, 3);
  ctx.fillStyle = "#fa654f";
  ctx.fillRect(ai.x - barWidth / 2, ai.y - 22, barWidth * ai.health / getAiMaxHealth(), 3);
}

function drawOverlay() {
  if (phase === "playing" || phase === "levelup") return;
  ctx.fillStyle = "rgba(7, 14, 17, .62)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = "#d7f36b";
  ctx.font = "500 15px 'DM Mono', monospace";
  ctx.fillText(phase === "ready" ? "SURVIVAL PROTOCOL / READY" : phase === "paused" ? "SIGNAL PAUSED" : "SIGNAL LOST", centerX, centerY - 39);
  ctx.fillStyle = "#f4f6ed";
  ctx.font = "700 42px 'Barlow Condensed', sans-serif";
  ctx.fillText(phase === "ready" ? "准备开始" : phase === "paused" ? "任务暂停" : "任务失败", centerX, centerY + 8);
  ctx.fillStyle = "#aab8b4";
  ctx.font = "14px 'Manrope', sans-serif";
  const hint = phase === "over" ? `存活 ${gameState.surviveTime} 秒  ·  按 Enter 再试一次` : "方向键移动  /  空格键发射";
  ctx.fillText(hint, centerX, centerY + 42);
}

function draw(now = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101b20";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#26363b";
  ctx.lineWidth = 1;
  for (let x = 50; x < canvas.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x + .5, 0);
    ctx.lineTo(x + .5, canvas.height);
    ctx.stroke();
  }
  for (let y = 50; y < canvas.height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y + .5);
    ctx.lineTo(canvas.width, y + .5);
    ctx.stroke();
  }

  gameState.aiList.forEach((ai) => {
    ctx.beginPath();
    ctx.arc(ai.spawn.x, ai.spawn.y, BALL_RADIUS + 16, 0, Math.PI * 2);
    ctx.strokeStyle = "#fa654f1b";
    ctx.stroke();
    drawAi(ai, now);
  });

  gameState.bullets.forEach((bullet) => {
    ctx.save();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 12;
    drawCircle(bullet.x, bullet.y, bullet.radius, "#f8fff0");
    ctx.restore();
  });

  gameState.enemyBullets.forEach((bullet) => {
    ctx.save();
    ctx.shadowColor = "#ffb84f";
    ctx.shadowBlur = 10;
    drawCircle(bullet.x, bullet.y, bullet.radius, "#ffb84f", "#fff1c7");
    ctx.restore();
  });

  drawPlayer();
  drawOverlay();
}

function gameLoop(now) {
  const delta = previousFrame ? Math.min(now - previousFrame, 40) : 0;
  previousFrame = now;
  if (phase === "playing") update(now, delta);
  draw(now);
  requestAnimationFrame(gameLoop);
}

function setDirectionKey(event, isDown) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return false;
  event.preventDefault();
  if (isDown) {
    keys.add(event.key);
    if (phase === "ready") startGame();
  } else {
    keys.delete(event.key);
  }
  return true;
}

document.addEventListener("keydown", (event) => {
  if (setDirectionKey(event, true)) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (phase === "ready") startGame();
    else fireBullet();
  } else if (event.key === "Enter" && phase !== "playing") {
    startGame();
  } else if (event.key === "Escape") {
    togglePause();
  }
});

document.addEventListener("keyup", (event) => setDirectionKey(event, false));
window.addEventListener("blur", () => keys.clear());
startButton.addEventListener("click", startGame);
pauseButton.addEventListener("click", togglePause);
restartButton.addEventListener("click", resetGame);
fireButton.addEventListener("click", fireBullet);
document.querySelectorAll("[data-upgrade]").forEach((button) => {
  button.addEventListener("click", () => {
    if (phase !== "levelup") return;
    if (button.dataset.upgrade === "damage") gameState.bonusDamage += 2;
    if (button.dataset.upgrade === "speed") gameState.bonusBulletSpeed += BULLET_SPEED_PER_UPGRADE * 2;
    if (button.dataset.upgrade === "multishot") {
      gameState.bulletCount += 1;
      gameState.multishotDamagePenalty = true;
    }
    levelupDialog.hidden = true;
    updateHud();
    setPhase("paused");
    startGame();
  });
});
soundToggle.addEventListener("click", () => {
  soundMuted = !soundMuted;
  soundToggle.dataset.muted = String(soundMuted);
  soundToggle.setAttribute("aria-pressed", String(!soundMuted));
  soundToggle.setAttribute("aria-label", soundMuted ? "开启音效" : "关闭音效");
  soundLabel.textContent = soundMuted ? "音效关" : "音效开";
  if (!soundMuted) ensureAudioContext();
});

document.querySelectorAll(".direction-button").forEach((button) => {
  const key = button.dataset.key;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    keys.add(key);
    if (phase === "ready") startGame();
  });
  const release = () => keys.delete(key);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "playing") setPhase("paused");
});

resetGame();
requestAnimationFrame(gameLoop);