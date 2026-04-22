/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useMultiplayer } from './hooks/useMultiplayer.ts';
import { Race } from './types.ts';
import { RACE_COLORS, PLAYER_COLORS } from './constants.ts';
import GameBoard from './components/GameBoard.tsx';
import UIOverlay from './components/UIOverlay.tsx';

export default function App() {
  const { game, playerId, updatePlayer, setReady, addBot, resetLobby, startGame, dispatchAction } = useMultiplayer();
  const myPlayer = game?.players.find(p => p.id === playerId);
  
  // Initialize state with real server values if available
  const [selectedRace, setSelectedRace] = useState<Race>(myPlayer?.race || 'ЛЮДИ');
  const [name, setName] = useState(myPlayer?.name || '');

  // Synchronize local state to server when changed by user, UNLESS ready (can't change when ready)
  React.useEffect(() => {
     if (myPlayer && !myPlayer.ready) {
        // Debounce name updates slightly or just limit frequency, but for now just send it to sync the lobby display
        const timeoutId = setTimeout(() => {
           updatePlayer(selectedRace, name);
        }, 100);
        return () => clearTimeout(timeoutId);
     }
  }, [selectedRace, name, updatePlayer]);

  if (!game) return (
    <div className="flex items-center justify-center h-screen bg-black text-white">
      Загрузка...
    </div>
  );

  if (game.status === 'LOBBY') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-white p-8 font-sans">
        <h1 className="text-6xl font-black mb-12 tracking-tight text-blue-500 uppercase italic">
          TRI-WAR <span className="text-white opacity-20 text-3xl font-light">Online</span>
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
          <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 shadow-2xl">
            <h2 className="text-2xl font-bold mb-8 text-gray-400 uppercase tracking-widest">Настройки</h2>
            
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2 text-gray-500 uppercase">Твое Имя</label>
              <input 
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Представься барон..."
                className="w-full bg-[#2a2a2a] border border-white/10 rounded-xl p-4 outline-none focus:ring-2 ring-blue-500/50 transition-all"
              />
            </div>

            <div className="mb-8">
              <label className="block text-sm font-semibold mb-2 text-gray-500 uppercase">Выбор Расы</label>
              <div className="grid grid-cols-2 gap-3">
                {(['ЛЮДИ', 'ОРКИ', 'НЕЖИТЬ', 'КРОВАВЫЕ ЭЛЬФЫ'] as Race[]).map(r => (
                  <button
                    key={r}
                    onClick={() => setSelectedRace(r)}
                    className={`p-4 rounded-xl border-2 transition-all font-bold ${
                      selectedRace === r 
                        ? 'bg-blue-600/20 border-blue-500 text-white' 
                        : 'bg-[#2a2a2a] border-transparent text-gray-500 hover:border-white/10'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setReady(selectedRace, name || `Игрок ${game.players.length + 1}`, !myPlayer?.ready)}
                className={`flex-1 py-5 rounded-2xl font-black text-xl tracking-tighter uppercase transition-all active:scale-95 ${
                  myPlayer?.ready 
                    ? 'bg-red-600/20 border border-red-500/50 text-red-400 hover:bg-red-600/30' 
                    : 'bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-600/20 text-white'
                }`}
              >
                {myPlayer?.ready ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'ГОТОВ К БОЮ'}
              </button>
              
              {game.players.length < 3 && (
                <button
                  onClick={addBot}
                  className="px-6 py-5 rounded-2xl bg-[#2a2a2a] border border-white/10 hover:border-white/30 text-gray-400 transition-all active:scale-95 flex items-center justify-center"
                  title="Добавить бота"
                >
                  <span className="text-2xl">+🤖</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col">
            <h2 className="text-2xl font-bold mb-8 text-gray-400 uppercase tracking-widest">Список Лобби</h2>
            <div className="flex-1 space-y-4">
              {game.players.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between bg-[#2a2a2a] p-4 rounded-2xl border border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full" style={{ backgroundColor: p.color }} />
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        {p.name} {p.id === playerId && '(Ты)'}
                        {p.isBot && <span title="Бот">🤖</span>}
                      </div>
                      <div className="text-xs text-gray-500 uppercase font-black tracking-widest" style={{ color: RACE_COLORS[p.race] }}>{p.race}</div>
                    </div>
                  </div>
                  <div className={`text-xs font-black uppercase px-3 py-1 rounded-full ${p.ready ? 'text-green-500 bg-green-500/10' : 'text-yellow-500 bg-yellow-500/10'}`}>
                    {p.ready ? 'Готов' : 'Ждет...'}
                  </div>
                </div>
              ))}
              {game.players.length === 0 && (
                 <div className="text-center text-gray-600 py-12 italic">Ожидание игроков...</div>
              )}
            </div>
            <div className="mt-auto">
              {(() => {
                const host = game.players.find(p => !p.isBot);
                const isHost = host && host.id === playerId;
                
                if (isHost) {
                  return (
                    <div className="flex flex-col gap-2 mb-4">
                      <button
                        onClick={startGame}
                        className={`w-full py-5 rounded-2xl font-black text-xl tracking-tighter uppercase transition-all active:scale-95 ${
                          game.players.length >= 2 && game.players.every(p => p.ready)
                            ? 'bg-green-600 hover:bg-green-500 shadow-xl shadow-green-600/20 text-white'
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        НАЧАТЬ ИГРУ
                      </button>
                      <button
                        onClick={() => {
                             resetLobby();
                        }}
                        className="w-full py-3 rounded-2xl font-bold tracking-widest text-xs uppercase transition-all bg-red-900/40 hover:bg-red-900/60 text-red-500 border border-red-900/50"
                      >
                        Сбросить Зал
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="pt-6 border-t border-white/5 text-gray-500 text-xs text-center leading-relaxed">
                {(() => {
                  const host = game.players.find(p => !p.isBot);
                  const isHost = host && host.id === playerId;
                  return isHost 
                    ? 'Вы хост. Нажмите "Начать игру", когда все игроки будут готовы.' 
                    : 'Ждите, когда хост запустит игру. Все игроки должны быть готовы.';
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden select-none">
      <GameBoard game={game} playerId={playerId!} dispatchAction={dispatchAction} />
      {game.status === 'FINISHED' && (
         <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 backdrop-blur-md">
            <h1 className="text-6xl font-black text-white mb-4">ИГРА ОКОНЧЕНА</h1>
            <p className="text-xl text-gray-400 mb-8">Чья-то крепость пала.</p>
            <button 
              onClick={() => dispatchAction({ type: 'LEAVE_GAME' })}
              className="bg-blue-600 px-8 py-4 rounded-2xl text-white font-bold hover:bg-blue-500 transition-all text-xl shadow-xl shadow-blue-900/50"
            >
              ВЕРНУТЬСЯ В ЛОББИ
            </button>
         </div>
      )}
      {game.status !== 'FINISHED' && (
         <UIOverlay game={game} playerId={playerId!} dispatchAction={dispatchAction} />
      )}
    </div>
  );
}
