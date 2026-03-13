import React, { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import Lobby from './components/Lobby';
import Game from './components/Game';

export default function App() {
  const [screen, setScreen] = useState('lobby'); // lobby | waiting | game
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => {
    socket.on('player-joined', ({ players }) => {
      setPlayers(players);
      const newPlayer = players[players.length - 1];
      showToast(`${newPlayer.name} joined!`);
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
      socket.off('player-joined');
      socket.off('player-left');
      socket.off('new-round');
      socket.off('submission-update');
      socket.off('judging-phase');
      socket.off('round-winner');
      socket.off('back-to-lobby');
    };
  }, [showToast]);

  const handleCreate = (name) => {
    socket.emit('create-room', { playerName: name }, (res) => {
      if (res.error) return showToast(res.error);
      setPlayerName(name);
      setRoomCode(res.roomCode);
      setPlayers(res.players);
      setIsHost(true);
      setScreen('waiting');
    });
  };

  const handleJoin = (name, code) => {
    socket.emit('join-room', { roomCode: code, playerName: name }, (res) => {
      if (res.error) return showToast(res.error);
      setPlayerName(name);
      setRoomCode(res.roomCode);
      setPlayers(res.players);
      setIsHost(false);
      setScreen('waiting');
    });
  };

  const handleStart = () => {
    socket.emit('start-game', (res) => {
      if (res.error) showToast(res.error);
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

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {screen === 'lobby' && (
        <Lobby onCreateRoom={handleCreate} onJoinRoom={handleJoin} />
      )}

      {screen === 'waiting' && (
        <div className="waiting-room">
          <h1 className="title">NERDS AGAINST<br/>HUMANITY</h1>
          <div className="room-code-display">
            <span className="room-code-label">ROOM CODE</span>
            <span className="room-code-value">{roomCode}</span>
            <span className="room-code-hint">Share this with your buddies</span>
          </div>
          <div className="player-list">
            <h3>Players ({players.length}/10)</h3>
            {players.map(p => (
              <div key={p.id} className="player-chip">
                {p.name} {p.isHost ? '👑' : ''}
              </div>
            ))}
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
        />
      )}
    </div>
  );
}
