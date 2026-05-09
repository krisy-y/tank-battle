const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Room management
const rooms = new Map();  // code -> { host, guest, state }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

// HTTP server (for health checks)
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  let roomCode = null;
  let isHost = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        if (roomCode) return;
        const code = generateCode();
        if (!code) { send(ws, { type: 'error', message: '服务器繁忙，请重试' }); return; }
        roomCode = code;
        isHost = true;
        rooms.set(code, { host: ws, guest: null, state: { host: null, guest: null } });
        send(ws, { type: 'room_created', code });
        console.log(`Room ${code} created`);
        break;
      }

      case 'join_room': {
        if (roomCode) return;
        const code = msg.code.toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }
        if (room.guest) { send(ws, { type: 'error', message: '房间已满' }); return; }
        if (room.host.readyState !== 1) { send(ws, { type: 'error', message: '房主已断开' }); return; }
        roomCode = code;
        isHost = false;
        room.guest = ws;
        send(ws, { type: 'room_joined', code });
        send(room.host, { type: 'opponent_joined' });
        console.log(`Guest joined room ${code}`);
        break;
      }

      case 'player_state': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        if (isHost) {
          room.state.host = msg.state;
          if (room.guest) send(room.guest, { type: 'opponent_state', state: msg.state });
        } else {
          room.state.guest = msg.state;
          if (room.host) send(room.host, { type: 'opponent_state', state: msg.state });
        }
        break;
      }

      case 'bullet_fired': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        const target = isHost ? room.guest : room.host;
        if (target) send(target, { type: 'opponent_bullet', bullet: msg.bullet });
        break;
      }

      case 'map_update': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        const target = isHost ? room.guest : room.host;
        if (target) send(target, { type: 'map_update', tile: msg.tile });
        break;
      }

      case 'request_join_info': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        // Send the current opponent state to the newly joined player
        const theirState = isHost ? room.state.guest : room.state.host;
        if (theirState) send(ws, { type: 'opponent_state', state: theirState });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const other = isHost ? room.guest : room.host;
        if (other && other.readyState === 1) {
          send(other, { type: 'opponent_disconnected' });
        }
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} closed`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Tank Battle Server running on port ${PORT}`);
});
