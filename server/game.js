// Game logic for Nerds Against Humanity

import { blackCards, whiteCards } from './cards.js';

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const HAND_SIZE = 10;
const POINTS_TO_WIN = 7;

export class GameRoom {
  constructor(roomCode, hostId, hostName) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players = new Map(); // socketId -> { name, score, hand }
    this.playerOrder = []; // socketIds in join order
    this.state = 'LOBBY'; // LOBBY | PICKING | JUDGING | ROUND_END | GAME_OVER
    this.blackDeck = [];
    this.whiteDeck = [];
    this.currentBlackCard = null;
    this.cardCzarIndex = 0;
    this.submissions = new Map(); // socketId -> { cards: string[], playerName: string }
    this.roundNumber = 0;
    this.pointsToWin = POINTS_TO_WIN;
    this.shuffledSubmissions = []; // anonymized for judging

    this.addPlayer(hostId, hostName);
  }

  addPlayer(socketId, name) {
    if (this.state !== 'LOBBY') return { error: 'Game already in progress' };
    if (this.players.has(socketId)) return { error: 'Already in room' };

    this.players.set(socketId, { name, score: 0, hand: [] });
    this.playerOrder.push(socketId);
    return { success: true };
  }

  removePlayer(socketId) {
    if (!this.players.has(socketId)) return;

    const wasHost = socketId === this.hostId;
    const wasCzar = this.playerOrder[this.cardCzarIndex] === socketId;

    this.players.delete(socketId);
    const orderIndex = this.playerOrder.indexOf(socketId);
    this.playerOrder.splice(orderIndex, 1);
    this.submissions.delete(socketId);

    // Transfer host
    if (wasHost && this.playerOrder.length > 0) {
      this.hostId = this.playerOrder[0];
    }

    // Fix czar index
    if (this.playerOrder.length === 0) return;
    if (this.cardCzarIndex >= this.playerOrder.length) {
      this.cardCzarIndex = 0;
    }

    // If game is in progress and we're below minimum players, end it
    if (this.state !== 'LOBBY' && this.playerOrder.length < 3) {
      this.state = 'GAME_OVER';
      return;
    }

    // If the czar left during judging/picking, advance round
    if (wasCzar && (this.state === 'PICKING' || this.state === 'JUDGING')) {
      this.startRound();
    }

    // If everyone except czar has submitted, move to judging
    if (this.state === 'PICKING' && this.allSubmitted()) {
      this.prepareJudging();
    }
  }

  startGame() {
    if (this.playerOrder.length < 3) return { error: 'Need at least 3 players' };

    this.blackDeck = shuffle(blackCards);
    this.whiteDeck = shuffle(whiteCards);
    this.cardCzarIndex = 0;
    this.roundNumber = 0;

    // Deal hands
    for (const [socketId] of this.players) {
      const player = this.players.get(socketId);
      player.hand = this.drawWhiteCards(HAND_SIZE);
      player.score = 0;
    }

    this.startRound();
    return { success: true };
  }

  drawWhiteCards(count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.whiteDeck.length === 0) {
        // Reshuffle — in a real game you'd use discards, but let's just reshuffle all
        this.whiteDeck = shuffle(whiteCards);
      }
      drawn.push(this.whiteDeck.pop());
    }
    return drawn;
  }

  startRound() {
    if (this.blackDeck.length === 0) {
      this.blackDeck = shuffle(blackCards);
    }

    this.roundNumber++;
    this.currentBlackCard = this.blackDeck.pop();
    this.submissions = new Map();
    this.shuffledSubmissions = [];
    this.state = 'PICKING';

    // Replenish hands
    for (const [socketId] of this.players) {
      const player = this.players.get(socketId);
      while (player.hand.length < HAND_SIZE) {
        const cards = this.drawWhiteCards(1);
        player.hand.push(...cards);
      }
    }
  }

  getCardCzarId() {
    return this.playerOrder[this.cardCzarIndex];
  }

  submitCards(socketId, cardIndices) {
    if (this.state !== 'PICKING') return { error: 'Not in picking phase' };
    if (socketId === this.getCardCzarId()) return { error: "Card Czar can't submit" };
    if (this.submissions.has(socketId)) return { error: 'Already submitted' };

    const player = this.players.get(socketId);
    if (!player) return { error: 'Player not found' };

    const pick = this.currentBlackCard.pick;
    if (cardIndices.length !== pick) return { error: `Must pick exactly ${pick} card(s)` };

    // Validate indices
    for (const idx of cardIndices) {
      if (idx < 0 || idx >= player.hand.length) return { error: 'Invalid card index' };
    }

    // Extract cards (remove from hand, highest index first to avoid shifting issues)
    const sortedIndices = [...cardIndices].sort((a, b) => b - a);
    const selectedCards = cardIndices.map(i => player.hand[i]);
    for (const idx of sortedIndices) {
      player.hand.splice(idx, 1);
    }

    this.submissions.set(socketId, {
      cards: selectedCards,
      playerName: player.name,
    });

    if (this.allSubmitted()) {
      this.prepareJudging();
    }

    return { success: true };
  }

  allSubmitted() {
    const nonCzarCount = this.playerOrder.length - 1;
    return this.submissions.size >= nonCzarCount;
  }

  prepareJudging() {
    // Shuffle submissions so czar can't tell who submitted what
    const entries = [...this.submissions.entries()];
    const shuffled = shuffle(entries);
    this.shuffledSubmissions = shuffled.map(([socketId, sub]) => ({
      socketId,
      cards: sub.cards,
      playerName: sub.playerName,
    }));
    this.state = 'JUDGING';
  }

  judgeWinner(submissionIndex) {
    if (this.state !== 'JUDGING') return { error: 'Not in judging phase' };
    if (submissionIndex < 0 || submissionIndex >= this.shuffledSubmissions.length) {
      return { error: 'Invalid submission' };
    }

    const winner = this.shuffledSubmissions[submissionIndex];
    const winnerPlayer = this.players.get(winner.socketId);
    if (winnerPlayer) {
      winnerPlayer.score++;
    }

    this.state = 'ROUND_END';

    // Check for game over
    if (winnerPlayer && winnerPlayer.score >= this.pointsToWin) {
      this.state = 'GAME_OVER';
    }

    // Advance czar
    this.cardCzarIndex = (this.cardCzarIndex + 1) % this.playerOrder.length;

    return {
      success: true,
      winnerName: winner.playerName,
      winnerSocketId: winner.socketId,
      winningCards: winner.cards,
      blackCard: this.currentBlackCard,
      gameOver: this.state === 'GAME_OVER',
    };
  }

  getPlayerList() {
    return this.playerOrder.map(id => {
      const p = this.players.get(id);
      return {
        id,
        name: p.name,
        score: p.score,
        isHost: id === this.hostId,
        isCzar: id === this.getCardCzarId(),
        hasSubmitted: this.submissions.has(id),
      };
    });
  }

  getAnonymousSubmissions() {
    return this.shuffledSubmissions.map(s => ({ cards: s.cards }));
  }

  getScores() {
    return this.playerOrder.map(id => {
      const p = this.players.get(id);
      return { name: p.name, score: p.score };
    }).sort((a, b) => b.score - a.score);
  }
}

// Room management
const rooms = new Map();

export function createRoom(hostId, hostName) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));

  const room = new GameRoom(code, hostId, hostName);
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function deleteRoom(code) {
  rooms.delete(code);
}

export function getRoomByPlayer(socketId) {
  for (const [, room] of rooms) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}
