import React, { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import Lobby from './components/Lobby';
import Game from './components/Game';

function getPlayerId() {
  let id = sessionStorage.getItem('nah-player-id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('nah-player-id', id);
  }
  return id;
}

const playerId = getPlayerId();

export default function App() {
  const [screen, setScreen] = useState('lobby'); // lobby | waiting | game
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [toast, setToast] = useState(null);
  const [themes, setThemes] = useState({});
  const [selectedThemes, setSelectedThemes] = useState(['standard']);

  const showToast = useCallback((msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => {
    // Attempt to reconnect to an existing game on socket connect
    const tryReconnect = () => {
      socket.emit('reconnect-attempt', { playerId }, (res) => {
        if (res.error) return; // No active game, stay on lobby
        setPlayerName(res.playerName);
        setRoomCode(res.roomCode);
        setPlayers(res.players);
        setIsHost(res.isHost);
        if (res.gameState) {
          setGameState(res.gameState);
          setScreen('game');
        } else {
          setScreen('waiting');
        }
        showToast('Reconnected!');
      });
    };

    if (socket.connected) {
      tryReconnect();
    }
    socket.on('connect', tryReconnect);

    socket.on('player-joined', ({ players }) => {
      setPlayers(players);
      const newPlayer = players[players.length - 1];
      showToast(`${newPlayer.name} joined!`);
    });

    socket.on('player-rejoined', ({ playerName: name, players }) => {
      setPlayers(players);
      showToast(`${name} reconnected!`);
    });

    socket.on('player-left', ({ playerName: name, players, gameState: state }) => {
      setPlayers(players);
      showToast(`${name} left the game`);
      if (state === 'GAME_OVER') {
        showToast('Not enough players — game over', 5000);
      }
      // Check if we're now the host
      const me = players.find(p => p.id === socket.id);
      if (me?.isHost) setIsHost(true);
    });

    socket.on('new-round', (data) => {
      setGameState({
        phase: 'picking',
        blackCard: data.blackCard,
        hand: data.hand,
        cardCzar: data.cardCzar,
        roundNumber: data.roundNumber,
        players: data.players,
        scores: data.scores,
        submissions: null,
        winner: null,
      });
      setPlayers(data.players);
      setScreen('game');
    });

    socket.on('submission-update', ({ players }) => {
      setPlayers(players);
      setGameState(prev => prev ? { ...prev, players } : prev);
    });

    socket.on('judging-phase', ({ submissions, blackCard, cardCzar }) => {
      setGameState(prev => ({
        ...prev,
        phase: 'judging',
        submissions,
        blackCard,
        cardCzar,
      }));
    });

    socket.on('round-winner', ({ winnerName, winningCards, blackCard, scores, gameOver, message }) => {
      setGameState(prev => ({
        ...prev,
        phase: gameOver ? 'gameover' : 'roundend',
        winner: { name: winnerName, cards: winningCards },
        blackCard,
        scores,
        gameOverMessage: message,
      }));
    });

    socket.on('back-to-lobby', ({ players }) => {
      setPlayers(players);
      setScreen('waiting');
      setGameState(null);
    });

    return () => {
      socket.off('connect', tryReconnect);
      socket.off('player-joined');
      socket.off('player-rejoined');
      socket.off('player-left');
      socket.off('new-round');
      socket.off('submission-update');
      socket.off('judging-phase');
      socket.off('round-winner');
      socket.off('back-to-lobby');
    };
  }, [showToast]);

  const handleCreate = (name) => {
    socket.emit('create-room', { playerName: name, playerId }, (res) => {
      if (res.error) return showToast(res.error);
      setPlayerName(name);
      setRoomCode(res.roomCode);
      setPlayers(res.players);
      setIsHost(true);
      setScreen('waiting');
      socket.emit('get-themes', (t) => setThemes(t));
    });
  };

  const handleJoin = (name, code) => {
    socket.emit('join-room', { roomCode: code, playerName: name, playerId }, (res) => {
      if (res.error) return showToast(res.error);
      setPlayerName(name);
      setRoomCode(res.roomCode);
      setPlayers(res.players);
      setIsHost(false);
      setScreen('waiting');
    });
  };

  const handleStart = () => {
    socket.emit('start-game', { selectedThemes }, (res) => {
      if (res.error) showToast(res.error);
    });
  };

  const toggleTheme = (themeId) => {
    setSelectedThemes(prev => {
      if (prev.includes(themeId)) {
        // Don't allow deselecting all
        if (prev.length <= 1) return prev;
        return prev.filter(t => t !== themeId);
      }
      return [...prev, themeId];
    });
  };

  const handleSubmit = (cardIndices) => {
    socket.emit('submit-cards', { cardIndices }, (res) => {
      if (res.error) showToast(res.error);
    });
  };

  const handleJudge = (index) => {
    socket.emit('judge-pick', { submissionIndex: index }, (res) => {
      if (res.error) showToast(res.error);
    });
  };

  const handleNextRound = () => {
    socket.emit('next-round');
  };

  const handlePlayAgain = () => {
    socket.emit('play-again');
  };

  const handleLeave = () => {
    socket.emit('leave-game', () => {
      setScreen('lobby');
      setRoomCode('');
      setPlayers([]);
      setIsHost(false);
      setGameState(null);
      setSelectedThemes(['standard']);
    });
  };

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {screen === 'lobby' && (
        <Lobby onCreateRoom={handleCreate} onJoinRoom={handleJoin} />
      )}

      {screen === 'waiting' && (
        <div className="waiting-room">
          <button className="leave-btn" onClick={handleLeave} title="Leave game">
            ✕
          </button>
          <h1 className="title">NERDS AGAINST<br/>HUMANITY</h1>
          <div className="room-code-display">
            <span className="room-code-label">ROOM CODE</span>
            <span className="room-code-value">{roomCode}</span>
            <span className="room-code-hint">Share this with your buddies</span>
          </div>
          {isHost && (
            <button
              className="btn btn-start"
              onClick={handleStart}
              disabled={players.length < 3}
            >
              {players.length < 3
                ? `Need ${3 - players.length} more player${3 - players.length > 1 ? 's' : ''}`
                : 'START GAME'}
            </button>
          )}
          {!isHost && (
            <p className="waiting-text">Waiting for host to start...</p>
          )}
          <div className="player-list">
            <h3>Players ({players.length}/10)</h3>
            {players.map(p => (
              <div key={p.id} className="player-chip">
                {p.name} {p.isHost ? '👑' : ''}
              </div>
            ))}
          </div>
          {isHost && Object.keys(themes).length > 0 && (
            <div className="theme-picker">
              <h3>Card Packs</h3>
              <div className="theme-grid">
                {Object.entries(themes).map(([id, theme]) => (
                  <div
                    key={id}
                    className={`theme-card ${selectedThemes.includes(id) ? 'selected' : ''}`}
                    onClick={() => toggleTheme(id)}
                  >
                    <span className="theme-icon">{theme.icon}</span>
                    <span className="theme-name">{theme.name}</span>
                    <span className="theme-desc">{theme.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'game' && gameState && (
        <Game
          gameState={gameState}
          myId={socket.id}
          onSubmit={handleSubmit}
          onJudge={handleJudge}
          onNextRound={handleNextRound}
          onPlayAgain={handlePlayAgain}
          isHost={isHost}
          onLeave={handleLeave}
        />
      )}
    </div>
  );
}
