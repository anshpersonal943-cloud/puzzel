const levels = [
  { size: 3, timeLimit: 60 },
  { size: 3, timeLimit: 60 },
  { size: 4, timeLimit: 120 },
  { size: 4, timeLimit: 120 },
  { size: 5, timeLimit: 180 },
  { size: 5, timeLimit: 180 }
];

const imageUrls = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1470770903676-69b98201ea1c?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1494526585095-c41746248156?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1518670544984-70b9a90de616?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517602302552-471fe67acf66?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1523413651479-597eb2da0ad6?w=400&h=400&fit=crop'
];

let shuffledImages = [];
let roomId = '';
let playerName = '';
let currentLevel = 0;
let gameStartTime = null;
let timerInterval = null;
let moveCount = 0;
let tiles = [];
let trayTiles = [];
let trayOrder = [];
let tileEls = {};
let currentImage = '';
let size = 3;
let playerFinished = false;
const AVATAR_COLORS = ['#FF6348', '#2ED573', '#FFA502', '#A55EEA', '#1ABC9C', '#FF4757', '#3742FA', '#E84393'];

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getCurrentLevelNumber() {
  return Math.floor(currentLevel / 2) + 1;
}

function getCurrentPuzzleInLevel() {
  return (currentLevel % 2) + 1;
}

function prepareShuffledImages(imageSet) {
  const source = Array.isArray(imageSet) && imageSet.length > 0 ? imageSet : imageUrls;
  const shuffled = shuffleArray(source);
  shuffledImages = [];
  for (let i = 0; i < levels.length; i++) {
    shuffledImages.push(shuffled[i % shuffled.length]);
  }
}

function getSelectedImageSet() {
  const select = document.getElementById('selectImageSet');
  return select ? select.value : 'set1';
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(viewId);
  if (view) view.classList.add('active');
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function updateLocalTimerDisplay() {
  const totalTimeEl = document.getElementById('gameTotalTime');
  if (!totalTimeEl || !gameStartTime) return;
  const elapsedSeconds = Math.floor((Date.now() - gameStartTime) / 1000);
  totalTimeEl.textContent = `Elapsed: ${formatTime(elapsedSeconds)}`;
}

function startLocalTimer() {
  if (timerInterval) return;
  if (!gameStartTime) gameStartTime = Date.now();
  updateLocalTimerDisplay();
  timerInterval = setInterval(updateLocalTimerDisplay, 1000);
}

function generateShuffle(size) {
  const total = size * size;
  const items = [];
  for (let i = 0; i < total; i++) items.push(i);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function renderRoomCode(code) {
  const display = document.getElementById('lobbyCode');
  if (!display) return;
  display.innerHTML = '';
  for (let i = 0; i < code.length; i++) {
    const charEl = document.createElement('div');
    charEl.className = 'room-code-char';
    charEl.textContent = code[i];
    display.appendChild(charEl);
  }
}

function renderLobbyPlayers() {
  const ul = document.getElementById('lobbyPlayers');
  if (!ul) return;
  ul.innerHTML = '';
  const li = document.createElement('li');
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.backgroundColor = avatarColor(playerName || 'Player');
  avatar.textContent = (playerName || 'P')[0].toUpperCase();
  li.appendChild(avatar);
  const nameEl = document.createElement('div');
  nameEl.className = 'pname';
  nameEl.textContent = playerName || 'Player';
  li.appendChild(nameEl);
  const tag = document.createElement('div');
  tag.className = 'tag tag-host';
  tag.textContent = 'Host';
  li.appendChild(tag);
  ul.appendChild(li);
}

function renderPlayerProgress(progress) {
  const container = document.getElementById('playerProgress');
  if (!container) return;
  container.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'progress-item';
  const avatar = document.createElement('div');
  avatar.className = 'progress-avatar';
  avatar.style.backgroundColor = avatarColor(playerName || 'Player');
  avatar.textContent = (playerName || 'P')[0].toUpperCase();
  item.appendChild(avatar);
  const info = document.createElement('div');
  info.className = 'progress-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'progress-name';
  nameEl.textContent = playerName || 'Player';
  info.appendChild(nameEl);
  const statusEl = document.createElement('div');
  statusEl.className = 'progress-percent';
  statusEl.textContent = `Level ${currentLevel + 1} • ${progress}%`;
  info.appendChild(statusEl);
  const timeEl = document.createElement('div');
  timeEl.className = 'progress-time';
  const elapsedSeconds = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
  timeEl.textContent = `Elapsed: ${formatTime(elapsedSeconds)}`;
  info.appendChild(timeEl);
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = `${progress}%`;
  bar.appendChild(fill);
  info.appendChild(bar);
  item.appendChild(info);
  container.appendChild(item);
}

function toast(message, type = 'info') {
  const toastBox = document.getElementById('toastBox');
  if (!toastBox) return;
  const toastEl = document.createElement('div');
  toastEl.className = 'toast visible toast-' + type;
  toastEl.textContent = message;
  toastBox.appendChild(toastEl);
  setTimeout(() => {
    toastEl.classList.remove('visible');
    setTimeout(() => toastEl.remove(), 300);
  }, 3000);
}

function startGame() {
  const selectedSet = getSelectedImageSet();
  const imageSet = selectedSet === 'set1'
    ? imageUrls.slice(0, 6)
    : selectedSet === 'set2'
      ? imageUrls.slice(3, 9)
      : imageUrls.slice(5, 11);
  prepareShuffledImages(imageSet);
  currentLevel = 0;
  gameStartTime = Date.now();
  playerFinished = false;
  showView('viewGame');
  initializeGame();
}

function initializeGame() {
  clearInterval(timerInterval);
  timerInterval = null;
  const level = levels[currentLevel];
  size = level.size;
  currentImage = shuffledImages[currentLevel] || imageUrls[currentLevel] || '';
  moveCount = 0;
  const levelNum = getCurrentLevelNumber();
  const puzzleNum = getCurrentPuzzleInLevel();
  const gameLevel = document.getElementById('gameLevel');
  if (gameLevel) gameLevel.textContent = `Level ${levelNum} - Puzzle ${puzzleNum}/2`;
  const moveEl = document.getElementById('gameMoves');
  if (moveEl) moveEl.textContent = '0 moves';
  const timeEl = document.getElementById('gameTotalTime');
  if (timeEl) timeEl.textContent = 'Elapsed: 00:00';
  const preview = document.getElementById('smallImagePreview');
  if (preview) preview.src = currentImage;
  const solvedOverlay = document.getElementById('solvedOverlay');
  if (solvedOverlay) solvedOverlay.classList.remove('visible');
  const nextLevelAction = document.getElementById('nextLevelAction');
  if (nextLevelAction) nextLevelAction.style.display = 'none';
  startLocalTimer();
  const totalTiles = size * size;
  tiles = Array(totalTiles).fill(-1);
  trayTiles = generateShuffle(size);
  trayOrder = trayTiles.slice();
  const board = document.getElementById('puzzleBoard');
  const tray = document.getElementById('tileTray');
  if (!board || !tray) return;
  board.querySelectorAll('.puzzle-tile, .drop-zone').forEach(t => t.remove());
  tray.innerHTML = '';
  tileEls = {};
  requestAnimationFrame(() => {
    const boardW = board.clientWidth;
    const gap = 3;
    const tileSize = Math.floor((boardW - gap * (size - 1)) / size);
    for (let pos = 0; pos < totalTiles; pos++) {
      const zone = document.createElement('div');
      zone.className = 'drop-zone';
      zone.dataset.pos = pos;
      zone.style.width = `${tileSize}px`;
      zone.style.height = `${tileSize}px`;
      zone.style.left = `${(pos % size) * (tileSize + gap)}px`;
      zone.style.top = `${Math.floor(pos / size) * (tileSize + gap)}px`;
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const tid = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(tid)) {
          const targetPos = parseInt(zone.dataset.pos, 10);
          tryMoveTileToPos(tid, targetPos);
        }
      });
      board.appendChild(zone);
    }
    tray.style.display = 'grid';
    tray.style.gridTemplateColumns = `repeat(${size}, ${tileSize}px)`;
    tray.style.gridAutoRows = `${tileSize}px`;
    tray.style.gap = `${gap}px`;
    tray.style.width = `${size * tileSize + gap * (size - 1)}px`;
    tray.style.minHeight = `${size * tileSize + gap * (size - 1)}px`;
    tray.style.justifyContent = 'center';
    tray.style.alignContent = 'start';
    trayTiles.forEach(tid => {
      createTileElement(tid, size, tileSize);
      tray.appendChild(tileEls[tid]);
    });
    updateTilePositions();
    renderPlayerProgress(calculateProgress());
  });
}

function createTileElement(tid, sizeParam, tileSize) {
  const el = document.createElement('div');
  el.className = 'puzzle-tile tray-piece';
  el.dataset.tid = tid;
  el.draggable = true;
  el.style.width = `${tileSize}px`;
  el.style.height = `${tileSize}px`;
  if (currentImage) {
    el.style.backgroundImage = `url('${currentImage}')`;
    el.style.backgroundSize = `${sizeParam * 100}% ${sizeParam * 100}%`;
    const row = Math.floor(tid / sizeParam);
    const col = tid % sizeParam;
    el.style.backgroundPosition = `${col * 100 / (sizeParam - 1)}% ${row * 100 / (sizeParam - 1)}%`;
  }
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', tid);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', e => e.preventDefault());
  el.addEventListener('drop', e => {
    e.preventDefault();
    const draggedTid = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const targetPos = parseInt(el.dataset.pos, 10);
    if (!isNaN(draggedTid) && !isNaN(targetPos)) {
      tryMoveTileToPos(draggedTid, targetPos);
    }
  });
  tileEls[tid] = el;
}

function updateTilePositions() {
  const board = document.getElementById('puzzleBoard');
  if (!board) return;
  const boardW = board.clientWidth;
  const gap = 3;
  const tileSize = Math.floor((boardW - gap * (size - 1)) / size);
  Object.keys(tileEls).forEach(tid => {
    const el = tileEls[tid];
    const pos = tiles.indexOf(parseInt(tid, 10));
    if (pos !== -1) {
      el.style.left = `${(pos % size) * (tileSize + gap)}px`;
      el.style.top = `${Math.floor(pos / size) * (tileSize + gap)}px`;
      el.dataset.pos = pos;
      el.classList.remove('tray-piece');
      el.classList.add('puzzle-tile');
      board.appendChild(el);
    } else if (trayTiles.includes(parseInt(tid, 10))) {
      delete el.dataset.pos;
      el.classList.add('tray-piece');
      el.classList.remove('puzzle-tile');
      el.style.left = '';
      el.style.top = '';
      el.style.transform = '';
    }
  });
  const tray = document.getElementById('tileTray');
  if (!tray) return;
  tray.innerHTML = '';
  trayTiles.slice().sort((a, b) => trayOrder.indexOf(a) - trayOrder.indexOf(b)).forEach(tid => {
    tray.appendChild(tileEls[tid]);
  });
}

function tryMoveTileToPos(tid, targetPos) {
  const currentPos = tiles.indexOf(tid);
  if (currentPos === targetPos) return;
  if (currentPos !== -1) {
    tiles[currentPos] = -1;
  } else {
    trayTiles = trayTiles.filter(id => id !== tid);
  }
  if (tiles[targetPos] !== -1) {
    const existing = tiles[targetPos];
    if (existing !== undefined && existing !== -1) {
      trayTiles.push(existing);
    }
  }
  tiles[targetPos] = tid;
  trayTiles = trayTiles.slice().sort((a, b) => trayOrder.indexOf(a) - trayOrder.indexOf(b));
  updateTilePositions();
  moveCount++;
  const movesEl = document.getElementById('gameMoves');
  if (movesEl) movesEl.textContent = `${moveCount} move${moveCount !== 1 ? 's' : ''}`;
  const progress = calculateProgress();
  renderPlayerProgress(progress);
  if (isSolved()) {
    showSolvedOverlay();
  }
}

function isSolved() {
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== i) return false;
  }
  return true;
}

function calculateProgress() {
  let correct = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === i) correct++;
  }
  return Math.round((correct / tiles.length) * 100);
}

function showSolvedOverlay() {
  const overlay = document.getElementById('solvedOverlay');
  if (overlay) overlay.classList.add('visible');
  const nextLevelAction = document.getElementById('nextLevelAction');
  if (nextLevelAction) nextLevelAction.style.display = 'flex';
  Object.keys(tileEls).forEach(tid => tileEls[tid].classList.add('solved-glow'));
  const puzzleNum = getCurrentPuzzleInLevel();
  const levelNum = getCurrentLevelNumber();
  let detailText = '';
  if (puzzleNum === 1) {
    detailText = 'Puzzle 1 of 2 complete! One more to go.';
  } else {
    detailText = `Level ${levelNum} complete! Click Next to continue.`;
  }
  const solvedDetail = document.getElementById('solvedDetail');
  if (solvedDetail) solvedDetail.textContent = detailText;
}

function nextLevel() {
  currentLevel++;
  if (currentLevel < levels.length) {
    initializeGame();
  } else {
    showWin();
  }
}

function showWin() {
  launchConfetti();
  const resultTitle = document.getElementById('resultTitle');
  const resultSub = document.getElementById('resultSub');
  if (resultTitle) resultTitle.textContent = 'Congratulations!';
  if (resultSub) resultSub.textContent = 'All levels complete!';
  renderResultPlayers();
  showView('viewResult');
}

function renderResultPlayers() {
  const container = document.getElementById('resultPlayers');
  if (!container) return;
  container.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'result-player-item';
  const nameEl = document.createElement('div');
  nameEl.className = 'result-player-name';
  nameEl.textContent = playerName || 'Player';
  const timeEl = document.createElement('div');
  timeEl.className = 'result-player-time';
  const totalSec = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
  timeEl.textContent = `Total time: ${formatTime(totalSec)}`;
  item.appendChild(nameEl);
  item.appendChild(timeEl);
  container.appendChild(item);
}

function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#FF6348', '#2ED573', '#FFA502', '#A55EEA', '#1ABC9C', '#FF4757', '#FFEAA7'];
  const particles = [];
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 300,
      y: canvas.height * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 18 - 3,
      w: Math.random() * 10 + 4,
      h: Math.random() * 6 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 14,
      grav: 0.28 + Math.random() * 0.12,
      opacity: 1
    });
  }
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx;
      p.vy += p.grav;
      p.y += p.vy;
      p.rot += p.rotV;
      p.opacity -= 0.005;
      if (p.opacity > 0 && p.y < canvas.height) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
    if (alive) requestAnimationFrame(draw);
  })();
}

const btnJoin = document.getElementById('btnJoin');
const btnCreate = document.getElementById('btnCreate');
const btnStart = document.getElementById('btnStart');
const btnLeave = document.getElementById('btnLeave');
const nextLevelBtn = document.getElementById('nextLevelBtn');
const nextLevelBtnAlt = document.getElementById('nextLevelBtnAlt');
const tileTray = document.getElementById('tileTray');

if (btnJoin) {
  btnJoin.addEventListener('click', () => {
    const nameInput = document.getElementById('inputName');
    const codeInput = document.getElementById('inputRoom');
    playerName = nameInput ? nameInput.value.trim() : 'Player';
    if (!playerName) { toast('Please enter your name', 'error'); return; }
    const code = codeInput ? codeInput.value.trim() : '';
    roomId = code ? code.toUpperCase() : 'LOCAL';
    renderRoomCode(roomId);
    renderLobbyPlayers();
    showView('viewLobby');
  });
}

if (btnCreate) {
  btnCreate.addEventListener('click', () => {
    const nameInput = document.getElementById('inputName');
    playerName = nameInput ? nameInput.value.trim() : 'Player';
    if (!playerName) { toast('Please enter your name', 'error'); return; }
    roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    renderRoomCode(roomId);
    renderLobbyPlayers();
    showView('viewLobby');
  });
}

if (btnStart) {
  btnStart.addEventListener('click', startGame);
}

if (btnLeave) {
  btnLeave.addEventListener('click', () => {
    playerName = '';
    roomId = '';
    showView('viewJoin');
  });
}

if (nextLevelBtn) {
  nextLevelBtn.addEventListener('click', () => {
    const overlay = document.getElementById('solvedOverlay');
    if (overlay) overlay.classList.remove('visible');
    const nextLevelAction = document.getElementById('nextLevelAction');
    if (nextLevelAction) nextLevelAction.style.display = 'none';
    Object.keys(tileEls).forEach(tid => tileEls[tid].classList.remove('solved-glow'));
    nextLevel();
  });
}

if (nextLevelBtnAlt) {
  nextLevelBtnAlt.addEventListener('click', () => {
    const overlay = document.getElementById('solvedOverlay');
    if (overlay) overlay.classList.remove('visible');
    const nextLevelAction = document.getElementById('nextLevelAction');
    if (nextLevelAction) nextLevelAction.style.display = 'none';
    Object.keys(tileEls).forEach(tid => tileEls[tid].classList.remove('solved-glow'));
    nextLevel();
  });
}

if (tileTray) {
  tileTray.addEventListener('dragover', e => e.preventDefault());
  tileTray.addEventListener('drop', e => {
    e.preventDefault();
    const tid = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(tid)) {
      const currentPos = tiles.indexOf(tid);
      if (currentPos !== -1) {
        tiles[currentPos] = -1;
        if (!trayTiles.includes(tid)) trayTiles.push(tid);
        trayTiles = trayTiles.slice().sort((a, b) => trayOrder.indexOf(a) - trayOrder.indexOf(b));
        updateTilePositions();
      }
    }
  });
}

showView('viewJoin');
