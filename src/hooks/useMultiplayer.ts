
import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, ClientToServerEvents, ServerToClientEvents, GameAction, Race } from '../types.ts';

export function useMultiplayer() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    // Determine or generate a stable session ID so players don't drop on reload
    let storedId = localStorage.getItem('rts_session_id');
    if (!storedId) {
        storedId = Math.random().toString(36).substring(2, 12);
        localStorage.setItem('rts_session_id', storedId);
    }

    const newSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
        query: { sessionId: storedId }
    });
    setSocket(newSocket);

    newSocket.on('game:init', ({ playerId, game }) => {
      setPlayerId(playerId);
      setGame(game);
    });

    newSocket.on('game:update', (updatedGame) => {
      setGame(updatedGame);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const joinGame = useCallback((name: string) => {
    socket?.emit('player:join', name);
  }, [socket]);

  const updatePlayer = useCallback((race: Race, name: string) => {
    socket?.emit('player:update', { race, name });
  }, [socket]);

  const setReady = useCallback((race: Race, name: string, ready: boolean) => {
    socket?.emit('player:ready', { race, name, ready });
  }, [socket]);

  const addBot = useCallback(() => {
    socket?.emit('player:add_bot');
  }, [socket]);

  const resetLobby = useCallback(() => {
    socket?.emit('lobby:reset');
  }, [socket]);

  const startGame = useCallback(() => {
    socket?.emit('game:start');
  }, [socket]);

  const dispatchAction = useCallback((action: GameAction) => {
    socket?.emit('game:action', action);
  }, [socket]);

  return {
    game,
    playerId,
    joinGame,
    updatePlayer,
    setReady,
    addBot,
    resetLobby,
    startGame,
    dispatchAction
  };
}
