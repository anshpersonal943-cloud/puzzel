import './style.css'

const socket = io();
let roomId, playerName, isHost = false;
let imageData, size = 3, tiles = [], emptyPos = { x: size - 1, y: size - 1 };
let startTime, timerInterval;
let solved = false;

const joinScreen = document.getElementById('join-screen');
const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const winnerScreen = document.getElementById('winner-screen');
const canvas = document.getElementById('puzzle-canvas');
const ctx = canvas.getContext('2d');

document.getElementById('join-btn').addEventListener('click', () => {
  roomId = document.getElementById('room-id').value;
  playerName = document.getElementById('player-name').value;
  if (roomId && playerName) {
    socket.emit('joinRoom', { roomId, playerName });
  }
});

document.getElementById('upload-btn').addEventListener('click', () => {
  const file = document.getElementById('image-upload').files[0];
  if (file) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('playerId', socket.id);
    fetch(`/upload/${roomId}`, { method: 'POST', body: formData });
  }
});

document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('startGame', roomId);
});

canvas.addEventListener('click', (e) => {
  if (!solved) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (canvas.width / size));
    const y = Math.floor((e.clientY - rect.top) / (canvas.height / size));
    moveTile(x, y);
  }
});

socket.on('joined', (data) => {
  isHost = data.isHost;
  joinScreen.style.display = 'none';
  lobby.style.display = 'block';
  document.getElementById('room-id-display').textContent = roomId;
  if (isHost) {
    document.getElementById('host-controls').style.display = 'block';
    document.getElementById('start-btn').style.display = 'block';
  }
  if (data.room.image) {
    imageData = data.room.image;
    loadImage();
  }
  updatePlayers(data.room.players);
});

socket.on('imageUpdated', (image) => {
  imageData = image;
  loadImage();
});

socket.on('playersUpdated', (players) => {
  updatePlayers(players);
});

socket.on('gameStarted', (data) => {
  startTime = data.startTime;
  lobby.style.display = 'none';
  game.style.display = 'block';
  shuffle();
  startTimer();
});

socket.on('rankingsUpdated', (rankings) => {
  updateRankings(rankings);
});

socket.on('winner', (winner) => {
  clearInterval(timerInterval);
  game.style.display = 'none';
  winnerScreen.style.display = 'block';
  document.getElementById('winner-name').textContent = winner.name;
  updateFinalRankings();
});

function updatePlayers(players) {
  const list = document.getElementById('players-list');
  list.innerHTML = '<h3>Players:</h3>' + players.map(p => `<div>${p.name}${p.id === socket.id ? ' (You)' : ''}</div>`).join('');
}

function loadImage() {
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    createTiles();
  };
  img.src = 'data:image/jpeg;base64,' + imageData;
}

function createTiles() {
  tiles = [];
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    tiles.push({ x, y, correctX: x, correctY: y });
  }
  tiles[size * size - 1].isEmpty = true;
  drawPuzzle();
}

function drawPuzzle() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const tileSize = canvas.width / size;
  tiles.forEach((tile, i) => {
    if (!tile.isEmpty) {
      const sx = tile.correctX * tileSize;
      const sy = tile.correctY * tileSize;
      const dx = tile.x * tileSize;
      const dy = tile.y * tileSize;
      ctx.drawImage(canvas, sx, sy, tileSize, tileSize, dx, dy, tileSize, tileSize);
    }
  });
  // Draw grid
  ctx.strokeStyle = '#000';
  for (let i = 1; i < size; i++) {
    ctx.beginPath();
    ctx.moveTo(i * tileSize, 0);
    ctx.lineTo(i * tileSize, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * tileSize);
    ctx.lineTo(canvas.width, i * tileSize);
    ctx.stroke();
  }
}

function moveTile(x, y) {
  const dx = Math.abs(x - emptyPos.x);
  const dy = Math.abs(y - emptyPos.y);
  if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
    const tileIndex = tiles.findIndex(t => t.x === x && t.y === y);
    const emptyIndex = tiles.findIndex(t => t.x === emptyPos.x && t.y === emptyPos.y);
    [tiles[tileIndex], tiles[emptyIndex]] = [tiles[emptyIndex], tiles[tileIndex]];
    tiles[tileIndex].x = emptyPos.x;
    tiles[tileIndex].y = emptyPos.y;
    tiles[emptyIndex].x = x;
    tiles[emptyIndex].y = y;
    emptyPos = { x, y };
    drawPuzzle();
    checkSolved();
  }
}

function shuffle() {
  // Simple shuffle
  for (let i = 0; i < 100; i++) {
    const possibleMoves = [];
    if (emptyPos.x > 0) possibleMoves.push({ x: emptyPos.x - 1, y: emptyPos.y });
    if (emptyPos.x < size - 1) possibleMoves.push({ x: emptyPos.x + 1, y: emptyPos.y });
    if (emptyPos.y > 0) possibleMoves.push({ x: emptyPos.x, y: emptyPos.y - 1 });
    if (emptyPos.y < size - 1) possibleMoves.push({ x: emptyPos.x, y: emptyPos.y + 1 });
    const move = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
    moveTile(move.x, move.y);
  }
}

function checkSolved() {
  const isSolved = tiles.every((tile, i) => {
    const x = i % size;
    const y = Math.floor(i / size);
    return tile.x === x && tile.y === y;
  });
  if (isSolved && !solved) {
    solved = true;
    const time = Date.now() - startTime;
    socket.emit('puzzleSolved', { roomId, time });
  }
}

function startTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('timer').textContent = `Time: ${elapsed}s`;
  }, 1000);
}

function updateRankings(rankings) {
  const list = document.getElementById('rankings');
  list.innerHTML = '<h3>Rankings:</h3>' + rankings.map((p, i) => `<div>${i + 1}. ${p.name} - ${Math.floor(p.time / 1000)}s</div>`).join('');
}

function updateFinalRankings() {
  // Assume rankings are updated
  const rankings = document.getElementById('final-rankings');
  rankings.innerHTML = '<h3>Final Rankings:</h3>' + Array.from(document.querySelectorAll('#rankings div')).slice(1).join('');
}