const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const roomHandler = require('./api/room');

// Serve the frontend HTML file
app.use(express.json({ limit: '32kb' }));
app.all('/api/room', roomHandler);
app.use(express.static(__dirname));

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6
});

// ============================================================
// GLOBAL GAME STATE
// ============================================================
const MAX_ROOM_SIZE = 50; // Increased to handle 40+ players per room

// ============================================================
// IN-MEMORY ROOM STORE
// Each room holds the full game state as specified:
// {
//   players: [{id, name, progress: 0}], // progress is percentage 0-100
//   image: "",       (base64 JPEG from host)
//   size: 3,
//   started: false,
//   startTime: null,
//   currentLevel: 0
// }
// ============================================================
const TOTAL_LEVELS = 3;
const rooms = {};

// Generate a 5-character room ID (no ambiguous chars like O/0/I/1)
function generateRoomId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  // Prevent collision
  if (rooms[id]) return generateRoomId();
  return id;
}

// Shuffle an array randomly
function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Generate a random tile order for the assembly puzzle.
function generateShuffle(size) {
  const total = size * size;
  const tiles = [];
  for (let i = 0; i < total; i++) tiles.push(i);

  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return tiles;
}

const IMAGE_SET_LENGTH = 6; // 2 puzzles per level × 3 levels
const IMAGE_SET_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function loadImageSetFromFolder(folder) {
  const dirPath = path.join(__dirname, folder);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const imageFiles = entries
      .filter(entry => entry.isFile() && IMAGE_SET_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name)
      .sort();

    const selectedFiles = shuffleArray(imageFiles).slice(0, IMAGE_SET_LENGTH);
    return selectedFiles.map(name => `/${folder.replace(/\\/g, '/')}/${name}`);
  } catch (error) {
    return [];
  }
}

let backendDefaultImageSet1 = loadImageSetFromFolder('images/Set1');
if (backendDefaultImageSet1.length !== IMAGE_SET_LENGTH) {
  backendDefaultImageSet1 = [
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop'
  ];
}

let backendDefaultImageSet2 = loadImageSetFromFolder('images/Set2');
if (backendDefaultImageSet2.length !== IMAGE_SET_LENGTH) {
  backendDefaultImageSet2 = [
    'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1499364615650-ec38552f4f34?w=400&h=400&fit=crop'
  ];
}

let backendDefaultImageSet3 = loadImageSetFromFolder('images/Set3');
if (backendDefaultImageSet3.length !== IMAGE_SET_LENGTH) {
  backendDefaultImageSet3 = [
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=400&h=400&fit=crop'
  ];
}

// Broadcast the updated player list to everyone in the room
function broadcastPlayers(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('playerListUpdate', {
    players: room.players.map(p => {
      const elapsedTime = p.startTime ? Date.now() - p.startTime : 0;
      return {
        id: p.id,
        name: p.name,
        progress: typeof p.progress === 'number' ? p.progress : 0,
        currentLevel: p.currentLevel || 0,
        currentPuzzle: p.currentPuzzle || 0,
        totalTime: p.totalTime || 0,
        elapsedTime: p.finished ? (p.totalTime || elapsedTime) : elapsedTime,
        finished: p.finished || false,
      };
    }),
    hostId: room.hostId,
    imageSets: room.imageSets || {},
  });
}

// ============================================================
// SOCKET.IO CONNECTION HANDLERS
// ============================================================
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── CREATE ROOM ──────────────────────────────────
  // The creator automatically becomes the host
  socket.on('createRoom', (name, callback) => {
    const roomId = generateRoomId();

    rooms[roomId] = {
      players: [],
      started: false,
      startLevel: 0,     // Which level to start from (0, 1, or 2)
      hostId: socket.id,
      imageSets: {
        set1: backendDefaultImageSet1.slice(),
        set2: backendDefaultImageSet2.slice(),
        set3: backendDefaultImageSet3.slice(),
      },
    };

    socket.join(roomId);
    socket.roomId = roomId;

    // Host is a spectator and does not play.
    // Players will join separately and be added to the players list.

    console.log(`[+] Room created: ${roomId} by ${name || 'Player'}`);

    callback({ roomId });
    broadcastPlayers(roomId);
  });

  // ── JOIN ROOM ────────────────────────────────────
  // Any player joins by room code
  socket.on('joinRoom', ({ roomId, name }, callback) => {
    roomId = (roomId || '').toUpperCase().trim();

    if (!rooms[roomId]) {
      if (callback) callback({ error: 'Room not found! Check the code.' });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    const room = rooms[roomId];

    // Add player to the room
    room.players.push({
      id: socket.id,
      name: name || 'Player',
      progress: 0,
      currentLevel: room.startLevel || 0,
      currentPuzzle: 0,
      totalTime: 0,
      finished: false,
      startTime: null,
    });

    if (callback) callback({ success: true });
    broadcastPlayers(roomId);
  });

  // ── START GAME ───────────────────────────────────
  // Only the host can start the game with a selected level
  socket.on('startGame', (data) => {
    const rid = socket.roomId;
    if (!rid || !rooms[rid]) return;
    const room = rooms[rid];

    if (socket.id !== room.hostId) return; // Permission check

    const startLevel = data && data.startLevel !== undefined ? data.startLevel : 0;
    const selectedSet = data && typeof data.selectedSet === 'string' ? data.selectedSet : 'set1';
    const customImageSet = Array.isArray(data?.customImageSet) && data.customImageSet.length === 3 && data.customImageSet.every(item => typeof item === 'string')
      ? data.customImageSet
      : null;

    if (customImageSet) {
      room.imageSets[selectedSet] = customImageSet;
    }

    const imageSet = room.imageSets[selectedSet] || room.imageSets.set1;
    room.startLevel = startLevel;
    room.selectedSet = selectedSet;
    room.imageSet = imageSet;
    room.started = true;

    console.log(`[Game] Starting game in room ${rid}`);
    console.log(`[Game] selectedSet: ${selectedSet}`);
    console.log(`[Game] imageSet type: ${typeof imageSet}, isArray: ${Array.isArray(imageSet)}`);
    console.log(`[Game] imageSet content:`, imageSet);
    console.log(`[Game] room.imageSets:`, room.imageSets);

    // Reset progress and timer state for all players
    const now = Date.now();
    room.players.forEach(p => {
      p.progress = 0;
      p.currentLevel = startLevel;
      p.currentPuzzle = 0;
      p.totalTime = 0;
      p.finished = false;
      p.startTime = now;
    });

    // Shuffle and send imageSet to players only; host remains in lobby.
    const imageSetToSend = Array.isArray(imageSet) ? shuffleArray(imageSet) : [];
    console.log(`[Game] Emitting gameStarted with shuffled imageSet:`, imageSetToSend);

    socket.to(rid).emit('gameStarted', {
      startLevel,
      imageSet: imageSetToSend,
    });
    // Notify host so they can display the game timer and have control to end the game
    if (room.hostId) {
      io.to(room.hostId).emit('hostGameStarted', { startTime: now });
    }
    broadcastPlayers(rid);
  });

  // ── END GAME BY HOST ─────────────────────────────────
  socket.on('endGameByHost', () => {
    const rid = socket.roomId;
    if (!rid || !rooms[rid]) return;
    const room = rooms[rid];
    // Only host may end the game
    if (socket.id !== room.hostId) return;
    room.started = false;
    room.endedByHost = true;
    // Inform all players that host ended the game
    io.to(rid).emit('gameEndedByHost', { message: 'Game has been ended by the host.' });
    // Optionally mark players as finished/inactive and broadcast updated list
    broadcastPlayers(rid);
  });

  // ── UPDATE PROGRESS ─────────────────────────────────
  socket.on('updateProgress', (progress) => {
    const rid = socket.roomId;
    if (!rid || !rooms[rid]) return;
    const room = rooms[rid];
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      // `progress` can be a number or an object { progress, level, puzzle }
      if (typeof progress === 'object' && progress !== null) {
        player.progress = typeof progress.progress === 'number' ? progress.progress : player.progress;
        if (typeof progress.level === 'number') player.currentLevel = progress.level;
        if (typeof progress.puzzle === 'number') player.currentPuzzle = progress.puzzle;
      } else if (typeof progress === 'number') {
        player.progress = progress;
      }
      broadcastPlayers(rid);
    }
  });

  // ── LEVEL COMPLETED ─────────────────────────────────
  socket.on('levelCompleted', (data) => {
    const rid = socket.roomId;
    if (!rid || !rooms[rid]) return;
    const room = rooms[rid];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Only count the level if the player is solving the current level
    if (data.level !== player.currentLevel) return;

    if (data.level + 1 < TOTAL_LEVELS) {
      player.currentLevel = data.level + 1;
      player.progress = 0;
    } else {
      player.finished = true;
      player.totalTime = Date.now() - player.startTime;
    }

    broadcastPlayers(rid);

    const allFinished = room.players.length > 0 && room.players.every(p => p.finished);
    if (allFinished) {
      const playersData = room.players.map(p => ({
        name: p.name,
        finished: p.finished,
        elapsedTime: p.finished ? p.totalTime : Date.now() - (p.startTime || Date.now()),
        progress: p.progress,
      }));
      io.to(rid).emit('gameCompleted', { players: playersData });
    }
  });

  // ── LEAVE ROOM ───────────────────────────────────
  // Player leaves the room
  socket.on('leaveRoom', () => {
    const rid = socket.roomId;
    if (!rid || !rooms[rid]) return;
    const room = rooms[rid];

    room.players = room.players.filter(p => p.id !== socket.id);

    // Transfer host to the next player
    if (room.hostId === socket.id && room.players.length > 0) {
      room.hostId = room.players[0].id;
      io.to(rid).emit('hostChanged', room.hostId);
    }

    // Delete empty rooms to free memory
    if (room.players.length === 0) {
      delete rooms[rid];
      console.log(`[x] Room deleted: ${rid}`);
    } else {
      broadcastPlayers(rid);
    }

    socket.leave(rid);
  });

  // ── DISCONNECT ───────────────────────────────────
  // Remove player, transfer host if needed, delete empty rooms
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);

    const rid = socket.roomId;
    if (!rid || !rooms[rid]) return;

    const room = rooms[rid];
    room.players = room.players.filter(p => p.id !== socket.id);

    // Transfer host to the next oldest player
    if (room.hostId === socket.id && room.players.length > 0) {
      room.hostId = room.players[0].id;
      io.to(rid).emit('hostChanged', room.hostId);
    }

    // Delete empty rooms to free memory
    if (room.players.length === 0) {
      delete rooms[rid];
      console.log(`[x] Room deleted: ${rid}`);
    } else {
      broadcastPlayers(rid);
    }
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Puzzle Party server running on http://localhost:${PORT}`);
});