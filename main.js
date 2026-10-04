const playerIdKey = 'puzzle-party-player-id';
let playerId = localStorage.getItem(playerIdKey);
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem(playerIdKey, playerId);
}
let sessionToken = localStorage.getItem('puzzle-party-session-token') || '';

const socketListeners = new Map();
let activeRoomId = '';
let roomPollTimer = null;
let roomPollInFlight = false;
let previousRoomState = null;

function notifySocketListeners(event, data) {
  (socketListeners.get(event) || []).forEach(listener => listener(data));
}

function stopRoomPolling() {
  if (roomPollTimer) clearInterval(roomPollTimer);
  roomPollTimer = null;
  previousRoomState = null;
}

async function pollRoom() {
  if (!activeRoomId || roomPollInFlight) return;
  roomPollInFlight = true;
  try {
    const response = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'poll', roomId: activeRoomId, playerId, sessionToken }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Room connection failed.');

    const state = result.state;
    const previous = previousRoomState;
    isHost = state.hostId === playerId;
    notifySocketListeners('playerListUpdate', state);

    if (state.started && !previous?.started) {
      if (isHost) {
        notifySocketListeners('hostGameStarted', { startTime: state.startedAt });
      } else {
        notifySocketListeners('gameStarted', {
          startLevel: state.startLevel,
          imageSet: state.imageSet,
        });
      }
    }
    if (state.endedByHost && !previous?.endedByHost) {
      notifySocketListeners('gameEndedByHost', { message: 'Game has been ended by the host.' });
    }
    if (state.completed && !previous?.completed) {
      notifySocketListeners('gameCompleted', { players: state.results });
    }
    previousRoomState = state;
  } catch (error) {
    console.error('[room-poll]', error);
  } finally {
    roomPollInFlight = false;
  }
}

function startRoomPolling() {
  stopRoomPolling();
  pollRoom();
  roomPollTimer = setInterval(pollRoom, 1800);
}

const socket = {
  on(event, listener) {
    if (!socketListeners.has(event)) socketListeners.set(event, []);
    socketListeners.get(event).push(listener);
  },
  async emit(event, payload, callback) {
    const actions = {
      createRoom: 'createRoom',
      joinRoom: 'joinRoom',
      startGame: 'startGame',
      endGameByHost: 'endGameByHost',
      updateProgress: 'updateProgress',
      levelCompleted: 'levelCompleted',
      leaveRoom: 'leaveRoom',
    };
    const body = { action: actions[event], playerId, sessionToken };
    if (event === 'createRoom') body.name = payload;
    else if (event === 'joinRoom') Object.assign(body, payload);
    else if (event === 'startGame') Object.assign(body, payload, { roomId: activeRoomId });
    else Object.assign(body, { roomId: activeRoomId, ...(payload || {}) });

    try {
      const response = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        const message = typeof result.error === 'string' ? result.error : result.error?.message;
        throw new Error(message || 'Room request failed.');
      }

      if (event === 'createRoom' || event === 'joinRoom') {
        activeRoomId = result.roomId || body.roomId;
        sessionToken = result.sessionToken;
        localStorage.setItem('puzzle-party-session-token', sessionToken);
        if (callback) callback(result);
        startRoomPolling();
      } else if (event === 'leaveRoom') {
        stopRoomPolling();
        activeRoomId = '';
        sessionToken = '';
        localStorage.removeItem('puzzle-party-session-token');
        if (callback) callback(result);
      } else if (callback) {
        callback(result);
      }
    } catch (error) {
      console.error('[room-action]', error);
      if (callback) callback({ error: error.message });
      else toast(error.message, 'error');
    }
  },
};
let roomId = '';
let playerName = '';
let isHost = false;
let currentImage = '';
let size = 3;
let tiles = [];
let trayTiles = [];
let trayOrder = [];
let tileEls = {};
let moveCount = 0;
let gameStartTime = null;
let timerInterval = null;
let imagesForGame = [];
let currentLevelIndex = 0;
let currentPuzzleIndex = 0;
let gameEndedByHost = false;
let hostGameStartTime = null;
let hostTimerInterval = null;
const PUZZLES_PER_LEVEL = 2;
const TOTAL_LEVELS = 3;
const levelSizes = [3, 4, 5];

const viewJoin = document.getElementById('viewJoin');
const viewLobby = document.getElementById('viewLobby');
const viewGame = document.getElementById('viewGame');
const viewResult = document.getElementById('viewResult');
const lobbyCode = document.getElementById('lobbyCode');
const lobbyPlayers = document.getElementById('lobbyPlayers');
const hostControls = document.getElementById('hostControls');
const waitBox = document.getElementById('waitBox');
const selectImageSet = document.getElementById('selectImageSet');
const btnCreate = document.getElementById('btnCreate');
const btnJoin = document.getElementById('btnJoin');
const btnStart = document.getElementById('btnStart');
const btnLeave = document.getElementById('btnLeave');
const nextLevelBtn = document.getElementById('nextLevelBtn');
const nextLevelBtnAlt = document.getElementById('nextLevelBtnAlt');
const toastBox = document.getElementById('toastBox');
const gameLevel = document.getElementById('gameLevel');
const gameMoves = document.getElementById('gameMoves');
const gameTotalTime = document.getElementById('gameTotalTime');
const smallImagePreview = document.getElementById('smallImagePreview');
const puzzleBoard = document.getElementById('puzzleBoard');
const tileTray = document.getElementById('tileTray');
const solvedOverlay = document.getElementById('solvedOverlay');
const nextLevelAction = document.getElementById('nextLevelAction');
const solvedDetail = document.getElementById('solvedDetail');
const resultTitle = document.getElementById('resultTitle');
const resultSub = document.getElementById('resultSub');
const resultPlayers = document.getElementById('resultPlayers');
const btnEnd = document.getElementById('btnEnd');
const hostGameTimer = document.getElementById('hostGameTimer');
const hostEndedOverlay = document.getElementById('hostEndedOverlay');
const btnHostEndedLeave = document.getElementById('btnHostEndedLeave');

function showView(viewId) {
  [viewJoin, viewLobby, viewGame, viewResult].forEach(view => view.classList.remove('active'));
  const view = document.getElementById(viewId);
  if (view) view.classList.add('active');
  const headerBrand = document.querySelector('.header-brand');
  if (headerBrand) headerBrand.style.display = viewId === 'viewGame' ? 'none' : '';
}

function toast(message, type = 'info') {
  if (!toastBox) return;
  const toastEl = document.createElement('div');
  toastEl.className = `toast visible toast-${type}`;
  toastEl.textContent = message;
  toastBox.appendChild(toastEl);
  setTimeout(() => {
    toastEl.classList.remove('visible');
    setTimeout(() => toastEl.remove(), 300);
  }, 3000);
}

function renderRoomCode(code) {
  if (!lobbyCode) return;
  lobbyCode.innerHTML = '';
  code.split('').forEach(char => {
    const charEl = document.createElement('div');
    charEl.className = 'room-code-char';
    charEl.textContent = char;
    lobbyCode.appendChild(charEl);
  });
}

function renderLobbyPlayers(players = [], hostId = '') {
  if (!lobbyPlayers) return;
  lobbyPlayers.innerHTML = '';

  if (players.length === 0) {
    const placeholder = document.createElement('li');
    placeholder.className = 'player-item';
    placeholder.innerHTML = '<div class="progress-meta">Waiting for players to join...</div>';
    lobbyPlayers.appendChild(placeholder);
    return;
  }

  const sortedPlayers = players.slice().sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.elapsedTime || 0) - (b.elapsedTime || 0);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.progress || 0) - (a.progress || 0);
  });

  sortedPlayers.forEach((player, index) => {
    const li = document.createElement('li');
    li.className = 'player-item';
    const progressLabel = player.finished
      ? `Finished in ${formatTime(Math.floor((player.elapsedTime || 0) / 1000))}`
      : `${player.progress || 0}% complete`;
    const levelIndex = typeof player.currentLevel === 'number' ? player.currentLevel : 0;
    const levelNum = levelIndex + 1;
    const imageNum = (typeof player.currentPuzzle === 'number' ? player.currentPuzzle : 0) + 1;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = getAvatarColor(player.name || 'Player');
    avatar.textContent = String(index + 1);
    const details = document.createElement('div');
    details.className = 'pname';
    details.append(document.createTextNode(player.name || 'Player'));
    const progress = document.createElement('div');
    progress.className = 'progress-meta';
    progress.textContent = `Level ${levelNum} • Image ${imageNum} • ${progressLabel}`;
    details.appendChild(progress);
    const rank = document.createElement('div');
    rank.className = 'tag';
    rank.textContent = `Rank #${index + 1}`;
    li.append(avatar, details, rank);
    lobbyPlayers.appendChild(li);
  });
}

function getAvatarColor(name) {
  const colors = ['#FF6348', '#2ED573', '#FFA502', '#A55EEA', '#1ABC9C', '#FF4757', '#3742FA', '#E84393'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function startTimer() {
  if (timerInterval) return;
  if (!gameStartTime) gameStartTime = Date.now();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateTimerDisplay() {
  if (!gameTotalTime || !gameStartTime) return;
  const seconds = Math.floor((Date.now() - gameStartTime) / 1000);
  gameTotalTime.textContent = `Elapsed: ${formatTime(seconds)}`;
}

function formatTime(total) {
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getBoardSize() {
  return levelSizes[currentLevelIndex] || 3;
}

async function prepareImageForPuzzle(imageUrl) {
  if (!imageUrl) return imageUrl;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const dimension = 1200;
      canvas.width = dimension;
      canvas.height = dimension;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageUrl);
        return;
      }

      ctx.fillStyle = '#f4efe8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      const offsetX = (canvas.width - drawWidth) / 2;
      const offsetY = (canvas.height - drawHeight) / 2;

      ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error(`Could not load puzzle image: ${imageUrl}`));
    image.src = imageUrl;
  });
}

async function setupTileGame(imageUrl) {
  if (!puzzleBoard || !tileTray) return;
  try {
    currentImage = await prepareImageForPuzzle(imageUrl);
  } catch (error) {
    console.error(error);
    currentImage = imageUrl;
  }

  size = getBoardSize();
  moveCount = 0;
  if (!gameStartTime) gameStartTime = Date.now();
  startTimer();
  tileEls = {};
  tiles = Array(size * size).fill(-1);
  trayTiles = shuffleArray(Array.from({ length: size * size }, (_, i) => i));
  trayOrder = trayTiles.slice();
  puzzleBoard.querySelectorAll('.drop-zone, .puzzle-tile').forEach(el => el.remove());
  tileTray.innerHTML = '';
  const boardWidth = puzzleBoard.clientWidth;
  const gap = 3;
  const tileSize = Math.floor((boardWidth - gap * (size - 1)) / size);

  for (let pos = 0; pos < size * size; pos++) {
    const zone = document.createElement('div');
    zone.className = 'drop-zone';
    zone.dataset.pos = pos;
    zone.style.width = `${tileSize}px`;
    zone.style.height = `${tileSize}px`;
    zone.style.left = `${(pos % size) * (tileSize + gap)}px`;
    zone.style.top = `${Math.floor(pos / size) * (tileSize + gap)}px`;
    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('drop', e => {
      e.preventDefault();
      if (gameEndedByHost) return;
      const tid = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (!Number.isNaN(tid)) moveTileToPos(tid, parseInt(zone.dataset.pos, 10));
    });
    puzzleBoard.appendChild(zone);
  }

  trayTiles.forEach(tid => createTileElement(tid, tileSize));

  // Configure the tray as a grid so shuffled tiles appear in a grid layout
  tileTray.style.display = 'grid';
  tileTray.style.gridTemplateColumns = `repeat(${size}, ${tileSize}px)`;
  tileTray.style.gridAutoRows = `${tileSize}px`;
  tileTray.style.gap = `${gap}px`;
  tileTray.style.width = `${size * tileSize + gap * (size - 1)}px`;
  tileTray.style.minHeight = `${size * tileSize + gap * (size - 1)}px`;
  tileTray.style.justifyContent = 'center';
  tileTray.style.alignContent = 'start';

  trayTiles.forEach(tid => tileTray.appendChild(tileEls[tid]));
  tileTray.addEventListener('dragover', e => e.preventDefault());
  tileTray.addEventListener('drop', e => {
    e.preventDefault();
    if (gameEndedByHost) return;
    const tid = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!Number.isNaN(tid)) moveTileToTray(tid);
  });
  updateTilePositions();
  // Report initial progress/state to server
  emitProgress();
  // reset host-end flag for players
  gameEndedByHost = false;
}

function createTileElement(tid, tileSize) {
  const el = document.createElement('div');
  el.className = 'puzzle-tile tray-piece';
  el.draggable = true;
  el.dataset.tid = tid;
  el.style.width = `${tileSize}px`;
  el.style.height = `${tileSize}px`;
  el.style.backgroundImage = `url('${currentImage}')`;
  el.style.backgroundSize = `${size * 100}% ${size * 100}%`;
  const row = Math.floor(tid / size);
  const col = tid % size;
  el.style.backgroundPosition = `${col * 100 / (size - 1)}% ${row * 100 / (size - 1)}%`;
  el.addEventListener('dragstart', e => {
    if (gameEndedByHost) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', tid);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', e => e.preventDefault());
  el.addEventListener('drop', e => {
    e.preventDefault();
    const draggedTid = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const targetTid = parseInt(el.dataset.tid, 10);
    if (Number.isNaN(draggedTid) || Number.isNaN(targetTid)) return;
    const targetPos = tiles.indexOf(targetTid);
    if (targetPos !== -1) {
      moveTileToPos(draggedTid, targetPos);
    }
  });
  tileEls[tid] = el;
}

function moveTileToPos(tid, targetPos) {
  if (gameEndedByHost) return;
  const existingTid = tiles[targetPos];
  if (existingTid === tid) return;
  const currentPos = tiles.indexOf(tid);
  if (currentPos !== -1) tiles[currentPos] = -1;

  if (existingTid !== -1 && existingTid !== undefined && existingTid !== tid) {
    moveTileToTray(existingTid, false);
  }

  tiles[targetPos] = tid;
  trayTiles = trayTiles.filter(id => id !== tid);
  updateTilePositions();
  moveCount += 1;
  if (gameMoves) gameMoves.textContent = `${moveCount} move${moveCount !== 1 ? 's' : ''}`;
  emitProgress();
  if (checkSolved()) onSolved();
}

function moveTileToTray(tid, update = true) {
  if (gameEndedByHost) return;
  const currentPos = tiles.indexOf(tid);
  if (currentPos !== -1) tiles[currentPos] = -1;
  if (!trayTiles.includes(tid)) trayTiles.push(tid);
  trayTiles = trayTiles.slice().sort((a, b) => trayOrder.indexOf(a) - trayOrder.indexOf(b));
  if (update) updateTilePositions();
}

function updateTilePositions() {
  if (!puzzleBoard || !tileTray) return;
  const boardWidth = puzzleBoard.clientWidth;
  const gap = 3;
  const tileSize = Math.floor((boardWidth - gap * (size - 1)) / size);

  Object.values(tileEls).forEach(el => {
    const tid = parseInt(el.dataset.tid, 10);
    if (tiles.includes(tid)) {
      const pos = tiles.indexOf(tid);
      el.style.left = `${(pos % size) * (tileSize + gap)}px`;
      el.style.top = `${Math.floor(pos / size) * (tileSize + gap)}px`;
      el.classList.remove('tray-piece');
      el.classList.add('puzzle-tile');
      puzzleBoard.appendChild(el);
    } else {
      el.style.left = '';
      el.style.top = '';
      el.classList.remove('puzzle-tile');
      el.classList.add('tray-piece');
    }
    el.style.width = `${tileSize}px`;
    el.style.height = `${tileSize}px`;
  });

  // Ensure the tray is configured as a grid (handles resizes) and render remaining tray tiles
  tileTray.style.display = 'grid';
  tileTray.style.gridTemplateColumns = `repeat(${size}, ${tileSize}px)`;
  tileTray.style.gridAutoRows = `${tileSize}px`;
  tileTray.style.gap = `${gap}px`;
  tileTray.style.width = `${size * tileSize + gap * (size - 1)}px`;
  tileTray.style.minHeight = `${size * tileSize + gap * (size - 1)}px`;
  tileTray.style.justifyContent = 'center';
  tileTray.style.alignContent = 'start';

  tileTray.innerHTML = '';
  // Preserve the shuffled tray order by appending tiles in trayOrder sequence.
  trayOrder.forEach(tid => {
    if (!tiles.includes(tid) && tileEls[tid]) {
      tileTray.appendChild(tileEls[tid]);
    }
  });
}

function checkSolved() {
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== i) return false;
  }
  return true;
}

function onSolved() {
  if (solvedOverlay) solvedOverlay.classList.add('visible');
  if (nextLevelAction) nextLevelAction.style.display = 'flex';
  Object.values(tileEls).forEach(el => el.classList.add('solved-glow'));

  let text = '';
  const isLastPuzzleInLevel = currentPuzzleIndex + 1 === PUZZLES_PER_LEVEL;
  const isLastLevel = currentLevelIndex + 1 === TOTAL_LEVELS;

  if (!isLastPuzzleInLevel) {
    text = `Puzzle ${currentPuzzleIndex + 1} complete! Click Next to continue to the next puzzle.`;
    if (nextLevelBtn) nextLevelBtn.textContent = 'Next Puzzle';
    if (nextLevelBtnAlt) nextLevelBtnAlt.textContent = 'Next Puzzle';
  } else if (!isLastLevel) {
    text = `Level ${currentLevelIndex + 1} complete! Click Next to move to Level ${currentLevelIndex + 2}.`;
    if (nextLevelBtn) nextLevelBtn.textContent = 'Next Level';
    if (nextLevelBtnAlt) nextLevelBtnAlt.textContent = 'Next Level';
  } else {
    text = 'All levels complete! Click Next to finish the game.';
    if (nextLevelBtn) nextLevelBtn.textContent = 'Finish';
    if (nextLevelBtnAlt) nextLevelBtnAlt.textContent = 'Finish';
  }

  if (solvedDetail) solvedDetail.textContent = text;
}

function updateGameHeader() {
  if (!gameLevel) return;
  const level = currentLevelIndex + 1;
  const puzzle = currentPuzzleIndex + 1;
  const boardSize = getBoardSize();
  gameLevel.textContent = `Level ${level} (${boardSize}×${boardSize}) - Puzzle ${puzzle}`;
}

function advancePuzzleOrLevel() {
  hideSolved();
  if (currentPuzzleIndex + 1 < PUZZLES_PER_LEVEL) {
    currentPuzzleIndex += 1;
  } else if (currentLevelIndex + 1 < TOTAL_LEVELS) {
    currentLevelIndex += 1;
    currentPuzzleIndex = 0;
  } else {
    showWin();
    return;
  }

  updateGameHeader();
  const nextImage = imagesForGame[currentLevelIndex * PUZZLES_PER_LEVEL + currentPuzzleIndex];
  if (smallImagePreview) smallImagePreview.src = nextImage;
  setupTileGame(nextImage);
  // Tell server which puzzle/level the player moved to
  emitProgress();
}

function showWin() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (solvedDetail) solvedDetail.textContent = 'All levels complete! Click Finish to submit your final time.';
  socket.emit('levelCompleted', { level: currentLevelIndex });
}

function emitProgress() {
  const progress = calculateProgress();
  socket.emit('updateProgress', { progress, level: currentLevelIndex, puzzle: currentPuzzleIndex });
}

function calculateProgress() {
  const correct = tiles.filter((t, index) => t === index).length;
  return Math.round((correct / tiles.length) * 100);
}

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('playerListUpdate', data => {
  if (!data) return;
  if (!roomId || !data.players) return;
  renderRoomCode(roomId);
  renderLobbyPlayers(data.players, data.hostId);
  if (hostControls && waitBox) {
    hostControls.style.display = isHost ? 'block' : 'none';
    waitBox.style.display = isHost ? 'none' : 'block';
  }
  // Show end button if host and a game is already in-progress on server
  if (isHost && btnEnd) {
    // If any player has progress > 0 or server indicates started, enable end button
    btnEnd.style.display = 'block';
  }
});

socket.on('gameStarted', data => {
  if (!data || !Array.isArray(data.imageSet) || data.imageSet.length < PUZZLES_PER_LEVEL * TOTAL_LEVELS) {
    toast('Could not start the game: insufficient image set received', 'error');
    return;
  }

  imagesForGame = data.imageSet.slice();
  currentLevelIndex = 0;
  currentPuzzleIndex = 0;
  gameStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  startTimer();

  updateGameHeader();
  if (smallImagePreview) smallImagePreview.src = imagesForGame[0];
  if (gameMoves) gameMoves.textContent = '0 moves';
  if (gameTotalTime) gameTotalTime.textContent = 'Elapsed: 00:00';
  showView('viewGame');
  setupTileGame(imagesForGame[0]);
  // Ensure host end overlay is hidden for players
  if (hostEndedOverlay) hostEndedOverlay.style.display = 'none';
});

socket.on('hostGameStarted', data => {
  // Only host receives this
  if (!isHost) return;
  hostGameStartTime = data?.startTime || Date.now();
  if (hostGameTimer) hostGameTimer.style.display = 'block';
  if (btnEnd) btnEnd.style.display = 'block';
  // start host timer
  if (hostTimerInterval) clearInterval(hostTimerInterval);
  // Update immediately and then every second
  const updateHostTimer = () => {
    const elapsed = Math.floor((Date.now() - hostGameStartTime) / 1000);
    if (hostGameTimer) hostGameTimer.textContent = `Elapsed: ${formatTime(elapsed)}`;
  };
  updateHostTimer();
  hostTimerInterval = setInterval(updateHostTimer, 1000);
});

socket.on('gameEndedByHost', data => {
  // Show overlay and prevent further actions for all players
  gameEndedByHost = true;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (hostTimerInterval) { clearInterval(hostTimerInterval); hostTimerInterval = null; }
  if (hostGameTimer) hostGameTimer.style.display = 'none';
  if (btnEnd) btnEnd.style.display = 'none';
  if (hostEndedOverlay) hostEndedOverlay.style.display = 'flex';
  // Lock interactions
  if (puzzleBoard) puzzleBoard.style.pointerEvents = 'none';
  if (tileTray) tileTray.style.pointerEvents = 'none';
  toast(data?.message || 'Game ended by host', 'info');
});

socket.on('gameCompleted', (data) => {
  if (resultTitle) resultTitle.textContent = 'Game Completed!';
  if (resultSub) resultSub.textContent = 'Thanks for playing.';
  renderResultPlayers(Array.isArray(data?.players) ? data.players : []);
  showView('viewResult');
});

btnCreate.addEventListener('click', () => {
  const nameInput = document.getElementById('inputName');
  playerName = nameInput ? nameInput.value.trim() : '';
  if (!playerName) { toast('Please enter your name', 'error'); return; }
  if (btnCreate) btnCreate.disabled = true;
  socket.emit('createRoom', playerName, response => {
    if (btnCreate) btnCreate.disabled = false;
    if (!response || !response.roomId) {
      toast(response?.error || 'Unable to create room', 'error');
      return;
    }
    roomId = response.roomId;
    isHost = true;
    renderRoomCode(roomId);
    showView('viewLobby');
    if (hostControls && waitBox) {
      hostControls.style.display = 'block';
      waitBox.style.display = 'none';
    }
  });
});

btnJoin.addEventListener('click', () => {
  const nameInput = document.getElementById('inputName');
  const codeInput = document.getElementById('inputRoom');
  playerName = nameInput ? nameInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  if (!playerName) { toast('Please enter your name', 'error'); return; }
  if (!code) { toast('Please enter a room code', 'error'); return; }
  if (btnJoin) btnJoin.disabled = true;
  roomId = code;
  socket.emit('joinRoom', { roomId, name: playerName }, response => {
    if (btnJoin) btnJoin.disabled = false;
    if (!response || response.error) { toast(response?.error || 'Room not found', 'error'); return; }
    isHost = false;
    renderRoomCode(roomId);
    showView('viewLobby');
    if (hostControls && waitBox) {
      hostControls.style.display = 'none';
      waitBox.style.display = 'block';
    }
  });
});

if (btnStart) {
  btnStart.addEventListener('click', () => {
    const selectedSet = selectImageSet ? selectImageSet.value : 'set1';
    socket.emit('startGame', { selectedSet });
  });
}

if (btnEnd) {
  btnEnd.addEventListener('click', () => {
    if (!confirm('End the game for all players? This cannot be undone.')) return;
    socket.emit('endGameByHost');
    // also locally trigger host overlay
    if (hostEndedOverlay) hostEndedOverlay.style.display = 'flex';
    if (hostTimerInterval) { clearInterval(hostTimerInterval); hostTimerInterval = null; }
    if (hostGameTimer) hostGameTimer.style.display = 'none';
    btnEnd.style.display = 'none';
  });
}

if (btnHostEndedLeave) {
  btnHostEndedLeave.addEventListener('click', () => {
    socket.emit('leaveRoom');
    roomId = '';
    playerName = '';
    isHost = false;
    showView('viewJoin');
  });
}

if (btnLeave) {
  btnLeave.addEventListener('click', () => {
    socket.emit('leaveRoom');
    roomId = '';
    playerName = '';
    isHost = false;
    showView('viewJoin');
  });
}

const hideSolved = () => {
  if (solvedOverlay) solvedOverlay.classList.remove('visible');
  if (nextLevelAction) nextLevelAction.style.display = 'none';
  Object.values(tileEls).forEach(el => el.classList.remove('solved-glow'));
};

if (nextLevelBtn) {
  nextLevelBtn.addEventListener('click', () => {
    advancePuzzleOrLevel();
  });
}

if (nextLevelBtnAlt) {
  nextLevelBtnAlt.addEventListener('click', () => {
    advancePuzzleOrLevel();
  });
}

function renderResultPlayers(finalPlayers = []) {
  if (!resultPlayers) return;
  resultPlayers.innerHTML = '';

  const sortedPlayers = finalPlayers.slice().sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.elapsedTime || 0) - (b.elapsedTime || 0);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.progress || 0) - (a.progress || 0);
  });

  sortedPlayers.forEach((player, index) => {
    const item = document.createElement('div');
    item.className = 'result-player-item';
    const name = document.createElement('div');
    name.className = 'result-player-name';
    name.textContent = `${index + 1}. ${player.name || 'Player'}`;
    const time = document.createElement('div');
    time.className = 'result-player-time';
    time.textContent = player.finished ? formatTime(Math.floor((player.elapsedTime || 0) / 1000)) : 'Incomplete';
    item.append(name, time);
    resultPlayers.appendChild(item);
  });
}

showView('viewJoin');
