const crypto = require('crypto');

const IMAGE_SETS = {
  set1: [
    '/images/Set1/download.jpg',
    '/images/Set1/filters_quality(95)format(webp).webp',
    '/images/Set1/large-cartoon-doraemon-nobita-shizuka-in-anywhere-door-wall-original-imah3ymzzhgh8836.webp',
  ],
  set2: [
    '/images/Set2/acwc2020-scaled.jpg',
    '/images/Set2/assetto-corsa-competizione-released-02.jpg',
    '/images/Set2/download (2).jpg',
    '/images/Set2/download.jpg',
    '/images/Set2/images.jpg',
    '/images/Set2/ss_fdfb6dcc30da5ea3adb496aa062a38c68ea4c889.1920x1080.jpg',
  ],
  set3: [
    '/images/Set3/118050.jpg',
    '/images/Set3/45988920-a96c-11ed-bb7e-d4c44f26d91d.jpg',
    '/images/Set3/images (1).jpg',
    '/images/Set3/images.jpg',
    '/images/Set3/LEVA-GTA-Cars-JD-Urus-7-copy-scaled - Copy.jpg',
    '/images/Set3/LEVA-GTA-Cars-JD-Urus-7-copy-scaled.jpg',
  ],
};

const ROOM_TTL_SECONDS = 21600;
const MAX_ROOM_SIZE = 50;
const SESSION_SECRET = process.env.ROOM_SESSION_SECRET || (process.env.VERCEL ? '' : crypto.randomBytes(32).toString('hex'));
const memoryRooms = new Map();

const compareAndSetScript = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'create' then
  if current then return 0 end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
if not current then return -1 end
local decoded = cjson.decode(current)
if tonumber(decoded.version or 0) ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

function shuffleArray(values) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = crypto.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildImageSets() {
  return Object.fromEntries(Object.entries(IMAGE_SETS).map(([name, images]) => {
    const completeSet = images.slice();
    while (completeSet.length < 6) completeSet.push(images[completeSet.length % images.length]);
    return [name, shuffleArray(completeSet)];
  }));
}

function makeRoomId() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

function createSessionToken(playerId, roomId) {
  if (!SESSION_SECRET) throw new Error('Configure ROOM_SESSION_SECRET to enable multiplayer.');
  const payload = Buffer.from(JSON.stringify({ playerId, roomId })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySessionToken(token, playerId, roomId) {
  if (!SESSION_SECRET || typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.playerId === playerId && session.roomId === roomId;
  } catch {
    return false;
  }
}

function getPlayer(room, playerId) {
  return room.players.find(player => player.id === playerId);
}

function applyAction(room, action, data) {
  const now = Date.now();

  if (action === 'joinRoom') {
    if (!room) return { error: 'Room not found! Check the code.' };
    if (data.playerId === room.hostId) return { error: 'The host cannot join as a player.' };
    if (room.started) return { error: 'This game has already started.' };
    if (room.players.some(player => player.id === data.playerId)) return { success: true };
    if (room.players.length >= MAX_ROOM_SIZE) return { error: 'Room is full.' };
    room.players.push({
      id: data.playerId,
      name: String(data.name || 'Player').trim().slice(0, 32) || 'Player',
      progress: 0,
      currentLevel: room.startLevel || 0,
      currentPuzzle: 0,
      totalTime: 0,
      finished: false,
      startTime: null,
    });
    return { success: true };
  }

  if (!room) return { error: 'Room not found! Check the code.' };

  if (action === 'startGame') {
    if (data.playerId !== room.hostId) return { error: 'Only the host can start the game.' };
    const selectedSet = Object.hasOwn(room.imageSets, data.selectedSet) ? data.selectedSet : 'set1';
    room.started = true;
    room.endedByHost = false;
    room.completed = false;
    room.selectedSet = selectedSet;
    room.startLevel = 0;
    room.imageSet = room.imageSets[selectedSet];
    room.startedAt = now;
    room.players.forEach(player => {
      player.progress = 0;
      player.currentLevel = 0;
      player.currentPuzzle = 0;
      player.totalTime = 0;
      player.finished = false;
      player.startTime = now;
    });
    return { success: true };
  }

  if (action === 'endGameByHost') {
    if (data.playerId !== room.hostId) return { error: 'Only the host can end the game.' };
    room.started = false;
    room.endedByHost = true;
    return { success: true };
  }

  if (action === 'updateProgress') {
    const player = getPlayer(room, data.playerId);
    if (!player) return { error: 'Player is not in this room.' };
    const progress = data.progress;
    if (typeof progress === 'object' && progress !== null) {
      if (typeof progress.progress === 'number') player.progress = progress.progress;
      if (typeof progress.level === 'number') player.currentLevel = progress.level;
      if (typeof progress.puzzle === 'number') player.currentPuzzle = progress.puzzle;
    } else if (typeof progress === 'number') {
      player.progress = progress;
    }
    return { success: true };
  }

  if (action === 'levelCompleted') {
    const player = getPlayer(room, data.playerId);
    if (!player) return { error: 'Player is not in this room.' };
    if (data.level !== player.currentLevel) return { success: true };
    if (data.level + 1 < 3) {
      player.currentLevel = data.level + 1;
      player.progress = 0;
    } else {
      player.finished = true;
      player.totalTime = now - (player.startTime || now);
    }
    room.completed = room.players.length > 0 && room.players.every(item => item.finished);
    return { success: true };
  }

  if (action === 'leaveRoom') {
    room.players = room.players.filter(player => player.id !== data.playerId);
    if (room.hostId === data.playerId) room.hostId = room.players[0]?.id || '';
    if (!room.hostId && room.players.length === 0) return { deleteRoom: true };
    return { success: true };
  }

  return { error: 'Unsupported room action.' };
}

function publicRoom(room) {
  const now = Date.now();
  const players = Array.isArray(room.players) ? room.players : [];
  return {
    hostId: room.hostId,
    players: players.map(player => {
      const elapsedTime = player.startTime ? now - player.startTime : 0;
      return {
        id: player.id,
        name: player.name,
        progress: typeof player.progress === 'number' ? player.progress : 0,
        currentLevel: player.currentLevel || 0,
        currentPuzzle: player.currentPuzzle || 0,
        totalTime: player.totalTime || 0,
        elapsedTime: player.finished ? (player.totalTime || elapsedTime) : elapsedTime,
        finished: Boolean(player.finished),
      };
    }),
    imageSets: room.imageSets,
    started: Boolean(room.started),
    startLevel: room.startLevel || 0,
    startedAt: room.startedAt || null,
    imageSet: Array.isArray(room.imageSet) ? room.imageSet : [],
    endedByHost: Boolean(room.endedByHost),
    completed: Boolean(room.completed),
    results: players.map(player => ({
      name: player.name,
      finished: Boolean(player.finished),
      elapsedTime: player.finished ? (player.totalTime || 0) : (player.startTime ? now - player.startTime : 0),
      progress: player.progress || 0,
    })),
  };
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable multiplayer.');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `Redis request failed (${response.status}).`);
  return result.result;
}

async function readRoom(roomId) {
  const key = `puzzle-room:${roomId}`;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const raw = await redisCommand(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  }
  if (process.env.VERCEL) throw new Error('Configure Upstash Redis before enabling multiplayer.');
  const room = memoryRooms.get(roomId);
  return room ? structuredClone(room) : null;
}

async function saveRoom(roomId, room, expectedVersion) {
  const key = `puzzle-room:${roomId}`;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const result = await redisCommand([
      'EVAL',
      compareAndSetScript,
      '1',
      key,
      String(expectedVersion),
      JSON.stringify(room),
      String(ROOM_TTL_SECONDS),
    ]);
    return Number(result);
  }
  if (process.env.VERCEL) throw new Error('Configure Upstash Redis before enabling multiplayer.');
  if (expectedVersion === 'create') {
    if (memoryRooms.has(roomId)) return 0;
  } else {
    const current = memoryRooms.get(roomId);
    if (!current) return -1;
    if (current.version !== expectedVersion) return 0;
  }
  memoryRooms.set(roomId, room);
  return 1;
}

async function createRoom(playerId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = makeRoomId();
    const room = {
      version: 1,
      hostId: playerId,
      players: [],
      imageSets: buildImageSets(),
      started: false,
      endedByHost: false,
      completed: false,
      startLevel: 0,
      startedAt: null,
      imageSet: [],
    };
    const saved = await saveRoom(roomId, room, 'create');
    if (saved === 1) return { roomId };
  }
  throw new Error('Could not allocate a room. Please try again.');
}

async function mutateRoom(roomId, action, data) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await readRoom(roomId);
    const result = applyAction(room, action, data);
    if (result.error || result.deleteRoom) {
      if (result.deleteRoom) {
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
          await redisCommand(['DEL', `puzzle-room:${roomId}`]);
        } else {
          memoryRooms.delete(roomId);
        }
      }
      return result;
    }
    const version = room.version || 0;
    room.version = version + 1;
    const saved = await saveRoom(roomId, room, version);
    if (saved === 1) return result;
    if (saved === -1) return { error: 'Room not found! Check the code.' };
  }
  return { error: 'Room changed at the same time. Please try again.' };
}

async function getSnapshot(roomId, playerId) {
  const room = await readRoom(roomId);
  if (!room) return { error: 'Room not found! Check the code.' };
  if (playerId !== room.hostId && !getPlayer(room, playerId)) return { error: 'You are no longer in this room.' };
  return { state: publicRoom(room) };
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function handler(request, response) {
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'Method not allowed.' });
    }

    const body = request.body || {};
    const action = body.action;
    const playerId = String(body.playerId || '');
    if (!playerId || playerId.length > 80) return sendJson(response, 400, { error: 'A valid player ID is required.' });
    if (!SESSION_SECRET) throw new Error('Configure ROOM_SESSION_SECRET to enable multiplayer.');

    if (action === 'createRoom') {
      const result = await createRoom(playerId);
      return sendJson(response, 200, { ...result, sessionToken: createSessionToken(playerId, result.roomId) });
    }

    const roomId = String(body.roomId || '').trim().toUpperCase();
    if (!roomId || roomId.length > 8) return sendJson(response, 400, { error: 'A valid room code is required.' });

    if (action === 'joinRoom') {
      const room = await readRoom(roomId);
      if (!room) return sendJson(response, 404, { error: 'Room not found! Check the code.' });
      if (getPlayer(room, playerId) && !verifySessionToken(body.sessionToken, playerId, roomId)) {
        return sendJson(response, 401, { error: 'This player identity is already in use.' });
      }
      const result = await mutateRoom(roomId, action, { ...body, playerId });
      if (result.error) return sendJson(response, 400, result);
      return sendJson(response, 200, {
        ...result,
        roomId,
        sessionToken: createSessionToken(playerId, roomId),
      });
    }

    if (!verifySessionToken(body.sessionToken, playerId, roomId)) {
      return sendJson(response, 401, { error: 'A valid room session is required.' });
    }

    if (action === 'poll') {
      const result = await getSnapshot(roomId, playerId);
      return sendJson(response, result.error ? 404 : 200, result);
    }

    const result = await mutateRoom(roomId, action, { ...body, playerId });
    return sendJson(response, result.error ? 400 : 200, result);
  } catch (error) {
    console.error('[room-api]', error);
    const status = error.message.includes('Configure Upstash') ? 503 : 500;
    return sendJson(response, status, { error: error.message || 'Room service failed.' });
  }
}

module.exports = handler;
