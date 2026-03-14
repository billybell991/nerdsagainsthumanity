import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRoom, getRoom, deleteRoom, getRoomByPlayer, getRoomByPlayerId } from './game.js';
import { themes } from './cards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:4000'],
    methods: ['GET', 'POST'],
  },
});

// Serve built client in production
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Reconnection: client sends playerId, server swaps socket and sends full state
  socket.on('reconnect-attempt', ({ playerId }, callback) => {
    if (!playerId) return callback({ error: 'No player ID' });

    const room = getRoomByPlayerId(playerId);
    if (!room) return callback({ error: 'No active game found' });

    const player = room.reconnectPlayer(playerId, socket.id);
    if (!player) return callback({ error: 'Could not reconnect' });

    socket.join(room.roomCode);
    const fullState = room.getFullState(socket.id);
    callback({ success: true, ...fullState });

    // Notify others that player is back
    socket.to(room.roomCode).emit('player-rejoined', {
      playerName: player.name,
      players: room.getPlayerList(),
    });
    console.log(`${player.name} reconnected to room ${room.roomCode}`);
  });

  socket.on('create-room', ({ playerName, playerId }, callback) => {
    if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
      return callback({ error: 'Name is required' });
    }
    const name = playerName.trim().substring(0, 20);
    const room = createRoom(socket.id, name);
    // Store playerId mapping
    if (playerId) {
      const player = room.players.get(socket.id);
      if (player) player.playerId = playerId;
      room.playerIdMap.set(playerId, socket.id);
    }
    socket.join(room.roomCode);
    callback({
      roomCode: room.roomCode,
      players: room.getPlayerList(),
    });
    console.log(`Room ${room.roomCode} created by ${name}`);
  });

  socket.on('join-room', ({ roomCode, playerName, playerId }, callback) => {
    if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
      return callback({ error: 'Name is required' });
    }
    if (!roomCode || typeof roomCode !== 'string') {
      return callback({ error: 'Room code is required' });
    }

    const name = playerName.trim().substring(0, 20);
    const code = roomCode.trim().toUpperCase();
    const room = getRoom(code);

    if (!room) return callback({ error: 'Room not found' });
    if (room.players.size >= 10) return callback({ error: 'Room is full (max 10)' });

    const result = room.addPlayer(socket.id, name, playerId);
    if (result.error) return callback(result);

    socket.join(code);
    const players = room.getPlayerList();
    callback({ roomCode: code, players });
    socket.to(code).emit('player-joined', { players });
    console.log(`${name} joined room ${code}`);
  });

  socket.on('get-themes', (callback) => {
    callback(themes);
  });

  socket.on('start-game', ({ selectedThemes } = {}, callback) => {
    // Handle legacy calls where first arg is the callback
    if (typeof selectedThemes === 'function') {
      callback = selectedThemes;
      selectedThemes = undefined;
    }
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback({ error: 'Not in a room' });
    if (socket.id !== room.hostId) return callback({ error: 'Only the host can start' });

    const result = room.startGame(selectedThemes);
    if (result.error) return callback(result);

    callback({ success: true });
    emitNewRound(room);
    console.log(`Game started in room ${room.roomCode}`);
  });

  socket.on('submit-cards', ({ cardIndices }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback({ error: 'Not in a room' });

    const result = room.submitCards(socket.id, cardIndices);
    if (result.error) return callback(result);

    callback({ success: true });

    // Tell everyone about submission progress
    const players = room.getPlayerList();
    io.to(room.roomCode).emit('submission-update', {
      players,
      submittedCount: room.submissions.size,
      totalNeeded: room.playerOrder.length - 1,
    });

    // If all submitted, send judging phase
    if (room.state === 'JUDGING') {
      io.to(room.roomCode).emit('judging-phase', {
        submissions: room.getAnonymousSubmissions(),
        blackCard: room.currentBlackCard,
        cardCzar: room.getCardCzarId(),
      });
    }
  });

  socket.on('judge-pick', ({ submissionIndex }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback({ error: 'Not in a room' });
    if (socket.id !== room.getCardCzarId()) return callback({ error: 'Only the Card Czar can judge' });

    const result = room.judgeWinner(submissionIndex);
    if (result.error) return callback(result);

    callback({ success: true });

    io.to(room.roomCode).emit('round-winner', {
      winnerName: result.winnerName,
      winningCards: result.winningCards,
      blackCard: result.blackCard,
      scores: room.getScores(),
      gameOver: result.gameOver,
    });
  });

  socket.on('next-round', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    if (room.state === 'GAME_OVER') return;

    // Only start next round if we're in ROUND_END
    if (room.state === 'ROUND_END') {
      room.startRound();
      emitNewRound(room);
    }
  });

  socket.on('play-again', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    if (socket.id !== room.hostId) return;

    // Reset room to lobby
    room.state = 'LOBBY';
    for (const [, player] of room.players) {
      player.score = 0;
      player.hand = [];
    }
    room.roundNumber = 0;
    room.cardCzarIndex = 0;

    io.to(room.roomCode).emit('back-to-lobby', {
      players: room.getPlayerList(),
    });
  });

  socket.on('leave-game', (callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ error: 'Not in a room' });

    const player = room.players.get(socket.id);
    const playerName = player?.name || 'Unknown';
    const playerId = player?.playerId;

    // Clear any reconnect timer
    if (playerId) {
      const timer = room.disconnectTimers.get(playerId);
      if (timer) {
        clearTimeout(timer);
        room.disconnectTimers.delete(playerId);
      }
      room.playerIdMap.delete(playerId);
    }

    socket.leave(room.roomCode);
    actuallyRemovePlayer(room, socket.id, playerName);
    console.log(`${playerName} voluntarily left room ${room.roomCode}`);
    callback?.({ success: true });
  });

  socket.on('disconnect', () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;

    const player = room.players.get(socket.id);
    const playerName = player?.name || 'Unknown';
    const playerId = player?.playerId;

    // If the player has a playerId, give them a grace period to reconnect
    if (playerId && room.state !== 'LOBBY') {
      console.log(`${playerName} disconnected from room ${room.roomCode} — waiting 30s for reconnect...`);
      const timer = setTimeout(() => {
        room.disconnectTimers.delete(playerId);
        actuallyRemovePlayer(room, socket.id, playerName);
      }, 30000);
      room.disconnectTimers.set(playerId, timer);
      return;
    }

    actuallyRemovePlayer(room, socket.id, playerName);
  });

  function actuallyRemovePlayer(room, socketId, playerName) {
    room.removePlayer(socketId);

    if (room.players.size === 0) {
      deleteRoom(room.roomCode);
      console.log(`Room ${room.roomCode} deleted (empty)`);
    } else {
      io.to(room.roomCode).emit('player-left', {
        playerName,
        players: room.getPlayerList(),
        gameState: room.state,
      });

      if (room.state === 'GAME_OVER') {
        io.to(room.roomCode).emit('round-winner', {
          winnerName: null,
          winningCards: [],
          blackCard: room.currentBlackCard,
          scores: room.getScores(),
          gameOver: true,
          message: 'Not enough players to continue',
        });
      }

      // If a new round was started because czar left
      if (room.state === 'PICKING') {
        emitNewRound(room);
      }
    }

    console.log(`${playerName} disconnected from room ${room.roomCode}`);
  }

  function emitNewRound(room) {
    // Send each player their own hand
    for (const socketId of room.playerOrder) {
      const player = room.players.get(socketId);
      io.to(socketId).emit('new-round', {
        blackCard: room.currentBlackCard,
        hand: player.hand,
        cardCzar: room.getCardCzarId(),
        roundNumber: room.roundNumber,
        players: room.getPlayerList(),
        scores: room.getScores(),
      });
    }
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🃏 Nerds Against Humanity server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);

  // Show LAN IP for phone access
  import('os').then(os => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`   Network: http://${net.address}:${PORT}`);
        }
      }
    }
    console.log(`\n   Share the Network URL with your buddies!\n`);
  });
});
