import React, { useState } from 'react';

export default function Lobby({ onCreateRoom, onJoinRoom }) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState(null); // null | 'create' | 'join'

  const handleCreate = (e) => {
    e.preventDefault();
    if (name.trim()) onCreateRoom(name.trim());
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (name.trim() && roomCode.trim()) onJoinRoom(name.trim(), roomCode.trim());
  };

  return (
    <div className="lobby">
      <div className="lobby-header">
        <h1 className="title">NERDS<br/>AGAINST<br/>HUMANITY</h1>
        <p className="subtitle">A party game for horrible nerds</p>
      </div>

      {!mode && (
        <div className="lobby-actions">
          <input
            type="text"
            className="input"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={20}
            autoComplete="off"
          />
          <button
            className="btn btn-create"
            onClick={() => name.trim() && setMode('create')}
            disabled={!name.trim()}
          >
            CREATE ROOM
          </button>
          <button
            className="btn btn-join"
            onClick={() => name.trim() && setMode('join')}
            disabled={!name.trim()}
          >
            JOIN ROOM
          </button>
        </div>
      )}

      {mode === 'create' && (
        <form className="lobby-form" onSubmit={handleCreate}>
          <p className="form-label">Playing as <strong>{name}</strong></p>
          <button type="submit" className="btn btn-create">LET'S GO</button>
          <button type="button" className="btn btn-back" onClick={() => setMode(null)}>BACK</button>
        </form>
      )}

      {mode === 'join' && (
        <form className="lobby-form" onSubmit={handleJoin}>
          <p className="form-label">Playing as <strong>{name}</strong></p>
          <input
            type="text"
            className="input input-code"
            placeholder="ROOM CODE"
            value={roomCode}
            onChange={e => setRoomCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoComplete="off"
            autoFocus
          />
          <button type="submit" className="btn btn-join" disabled={roomCode.trim().length < 4}>JOIN</button>
          <button type="button" className="btn btn-back" onClick={() => setMode(null)}>BACK</button>
        </form>
      )}
    </div>
  );
}
