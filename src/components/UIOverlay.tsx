
import React from 'react';
import { GameState, GameAction, EntityType } from '../types.ts';
import { UNIT_STATS, PLAYER_COLORS, RACE_COLORS } from '../constants.ts';

interface UIOverlayProps {
  game: GameState;
  playerId: string;
  dispatchAction: (action: GameAction) => void;
}

const RACE_TO_DIR: Record<string, string> = {
    'КРОВАВЫЕ ЭЛЬФЫ': 'elf',
    'ОРКИ': 'orc',
    'НЕЖИТЬ': 'undead',
    'ЛЮДИ': 'human'
};

const ENTITY_TO_FILE: Record<string, string> = {
    'РАБОЧИЙ': 'worker',
    'ВОИН': 'warrior',
    'ЛУЧНИК': 'archer',
    'ОСАДНОЕ': 'siege',
    'СТЕНА': 'wall',
    'БАШНЯ': 'tower',
    'ВОРОТА': 'gate',
    'КАЗАРМА': 'barracks',
    'ЗАМОК': 'castle',
    'АЛТАРЬ': 'altar',
    'ГЕРОЙ': 'hero'
};

export default function UIOverlay({ game, playerId, dispatchAction }: UIOverlayProps) {
  const { currentPlayerIndex, actionsRemaining, players, entities } = game;
  const currentPlayer = players[currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === playerId;
  
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [targetedInfo, setTargetedInfo] = React.useState<{x: number, y: number, hasResource: boolean, isGate?: boolean, entityId?: string, isEnemy?: boolean} | null>(null);
  const [openMenu, setOpenMenu] = React.useState<'BUILD' | 'DEFENSE' | null>(null);
  
  const selectedEntity = entities.find(e => e.id === selectedId);
  const myPlayer = players.find(p => p.id === playerId);

  React.useEffect(() => {
    const handleSelect = (e: any) => {
        setSelectedId(e.detail);
        setOpenMenu(null);
    };
    const handleTargeted = (e: any) => {
        setTargetedInfo(e.detail);
        setOpenMenu(null);
    };
    window.addEventListener('cell-entity-selected', handleSelect);
    window.addEventListener('cell-targeted', handleTargeted);
    return () => {
        window.removeEventListener('cell-entity-selected', handleSelect);
        window.removeEventListener('cell-targeted', handleTargeted);
    };
  }, []);

  const endTurn = () => {
    dispatchAction({ type: 'END_TURN' });
  };

  let isGateJumpTarget = false;
  let isAdjacentOrGateJump = false;

  if (selectedEntity && targetedInfo) {
      const dx = targetedInfo.x - selectedEntity.x;
      const dy = targetedInfo.y - selectedEntity.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const moveRange = UNIT_STATS[selectedEntity.race][selectedEntity.type].moveRange || 1;

      if (dist <= moveRange && dist > 0) {
          isAdjacentOrGateJump = true;
      } else if (dist === 2 && dx % 2 === 0 && dy % 2 === 0 && moveRange === 1) {
          const midX = selectedEntity.x + dx / 2;
          const midY = selectedEntity.y + dy / 2;
          const midGate = entities.find(e => e.x === midX && e.y === midY && e.type === 'ВОРОТА' && e.ownerId === playerId);
          if (midGate) {
              isGateJumpTarget = true;
              isAdjacentOrGateJump = true;
          }
      }
  }

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
      {/* Top Bar */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="flex gap-4">
          {myPlayer && (
            <div className="bg-black/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 text-white min-w-[200px]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-black mb-2 flex justify-between">
                <span>Мои Ресурсы: <span className="text-white italic">{myPlayer.name}</span></span>
                {currentPlayer && currentPlayer.id !== playerId && (
                    <span className="text-blue-400 animate-pulse">Ход: {currentPlayer.name}</span>
                )}
                {currentPlayer && currentPlayer.id === playerId && (
                    <span className="text-green-400 font-bold">ВАШ ХОД</span>
                )}
              </div>
              <div className="flex gap-6 items-center">
                <ResourceBadge type="ЗОЛОТО" amount={myPlayer.resources.ЗОЛОТО} color="text-yellow-400" />
                <ResourceBadge type="ДЕРЕВО" amount={myPlayer.resources.ДЕРЕВО} color="text-green-400" />
                <ResourceBadge type="МЯСО" amount={myPlayer.resources.МЯСО} color="text-red-400" />
              </div>
            </div>
          )}
          <div className="bg-black/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex flex-col items-center justify-center min-w-[120px]">
             <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Осталось ходов</div>
             <div className={`text-4xl font-black ${isMyTurn ? 'text-blue-500' : 'text-gray-600'}`}>{actionsRemaining}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isMyTurn && (
            <button 
              onClick={endTurn}
              className="bg-red-600 hover:bg-red-500 text-white px-8 py-4 rounded-xl font-black tracking-tighter transition-all active:scale-95 shadow-xl shadow-red-900/40"
            >
              ЗАВЕРШИТЬ ШАГ
            </button>
          )}

          <button
            onClick={() => {
              dispatchAction({ type: 'LEAVE_GAME' });
            }}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 px-6 py-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95"
          >
            ВЫЙТИ
          </button>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="flex justify-center pointer-events-auto">
        {selectedEntity ? (
          <div className="bg-black/90 backdrop-blur-2xl p-6 rounded-t-3xl border-x border-t border-white/10 flex gap-12 text-white items-center min-w-[800px] animate-in slide-in-from-bottom duration-500">
            <div className="flex gap-5 items-center border-r border-white/5 pr-12">
              <div 
                className="w-24 h-24 shrink-0 rounded-2xl flex items-center justify-center text-4xl font-black border-2 overflow-hidden relative"
                style={{ borderColor: PLAYER_COLORS[game.players.findIndex(p => p.id === selectedEntity.ownerId) % 4], backgroundColor: RACE_COLORS[selectedEntity.race] + '33' }}
              >
                <PortraitImage 
                  race={selectedEntity.race} 
                  type={selectedEntity.type} 
                  color={PLAYER_COLORS[game.players.findIndex(p => p.id === selectedEntity.ownerId) % 4]}
                />
              </div>
              <div className="flex-1">
                <h3 className="text-3xl font-black tracking-tighter uppercase italic">{UNIT_STATS[selectedEntity.race][selectedEntity.type].name}</h3>
                <div className="text-xs text-gray-500 uppercase font-bold tracking-widest">
                  Владелец: {players.find(p => p.id === selectedEntity.ownerId)?.name || 'Неизвестно'}
                </div>
                <div className="mt-2 w-48 h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/10">
                  <div 
                    className="h-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] transition-all duration-500" 
                    style={{ width: `${(selectedEntity.hp / selectedEntity.maxHp) * 100}%` }}
                  />
                </div>
                <div className="text-[10px] mt-1.5 font-mono uppercase text-gray-500 flex justify-between">
                    <span>HP: {selectedEntity.hp}/{selectedEntity.maxHp}</span>
                    {selectedEntity.underConstruction && <span className="text-yellow-500 animate-pulse">Строится ({selectedEntity.constructionTurnsLeft} ход.)</span>}
                </div>
              </div>
            </div>

            {selectedEntity.ownerId === playerId && isMyTurn ? (
               <div className="flex items-center gap-4 flex-1">
                  {/* Status / HP (simplified) */}
                  <div className="flex-none w-32">
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/10">
                      <div className="h-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" style={{ width: `${(selectedEntity.hp / selectedEntity.maxHp) * 100}%` }} />
                    </div>
                    <div className="text-[10px] mt-1 font-mono text-gray-500 flex justify-between">
                      {selectedEntity.hp} HP
                    </div>
                  </div>

                  {/* Context Actions (Confirmation-based) */}
                  <div className="flex gap-2">
                    {targetedInfo && !targetedInfo.hasResource && isAdjacentOrGateJump && !['ЗАМОК', 'КАЗАРМА', 'СТЕНА', 'БАШНЯ', 'ВОРОТА'].includes(selectedEntity.type) && !targetedInfo.isEnemy && (
                      <ActionButton accent label={isGateJumpTarget || targetedInfo.isGate ? "Пройти врата" : "Идти"} sub={isGateJumpTarget || targetedInfo.isGate ? "2 хода" : "Подтвердить"} onClick={() => window.dispatchEvent(new CustomEvent('plan-move'))} />
                    )}

                    {targetedInfo?.isEnemy && (
                        <button 
                         onClick={() => dispatchAction({ type: 'ATTACK', attackerId: selectedId!, targetId: targetedInfo.entityId! })}
                         className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 rounded-2xl flex flex-col items-center justify-center min-w-[160px] border-b-4 border-orange-800 transition-all active:translate-y-1 active:border-b-0 shadow-lg shadow-orange-900/40 pointer-events-auto"
                        >
                            <span className="text-sm font-black tracking-widest uppercase">АТАКОВАТЬ</span>
                            <span className="text-[9px] font-bold opacity-70">1 ХОД</span>
                        </button>
                    )}

                    {targetedInfo?.hasResource && isAdjacentOrGateJump && selectedEntity.type === 'РАБОЧИЙ' && (
                      <ActionButton accent label="Добыть" sub="Собрать 50" onClick={() => window.dispatchEvent(new CustomEvent('plan-harvest'))} />
                    )}
                  </div>

                  {/* Menus */}
                  {selectedEntity.type === 'РАБОЧИЙ' && (
                    <div className="flex gap-2 border-l border-white/10 pl-4 items-center">
                      <div className="relative">
                        <ActionButton 
                          label="Здания" 
                          sub={openMenu === 'BUILD' ? '▲ Закрыть' : '▼ Открыть'} 
                          onClick={() => setOpenMenu(openMenu === 'BUILD' ? null : 'BUILD')} 
                        />
                        {openMenu === 'BUILD' && (
                          <div className="absolute bottom-[calc(100%+1rem)] left-0 flex flex-col gap-2 bg-[#0a0a0a] p-3 rounded-2xl border border-white/10 min-w-[160px] shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                             {!targetedInfo && <div className="text-[10px] text-yellow-500/50 mb-1 px-1">Выберите клетку рядом</div>}
                             <ActionButton 
                                disabled={!targetedInfo}
                                label="Казарма" sub="50 З / 150 Д" 
                                onClick={() => targetedInfo && window.dispatchEvent(new CustomEvent('plan-build', { detail: 'КАЗАРМА' }))} 
                             />
                             <ActionButton 
                                disabled={!targetedInfo}
                                label="Алтарь" sub="80 З / 100 Д" 
                                onClick={() => targetedInfo && window.dispatchEvent(new CustomEvent('plan-build', { detail: 'АЛТАРЬ' }))} 
                             />
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <ActionButton 
                          label="Оборона" 
                          sub={openMenu === 'DEFENSE' ? '▲ Закрыть' : '▼ Открыть'} 
                          onClick={() => setOpenMenu(openMenu === 'DEFENSE' ? null : 'DEFENSE')} 
                        />
                        {openMenu === 'DEFENSE' && (
                          <div className="absolute bottom-[calc(100%+1rem)] left-0 flex flex-col gap-2 bg-[#0a0a0a] p-3 rounded-2xl border border-white/10 min-w-[160px] shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                            {!targetedInfo && <div className="text-[10px] text-yellow-500/50 mb-1 px-1">Выберите клетку рядом</div>}
                            <ActionButton 
                              disabled={!targetedInfo}
                              label="Башня" sub="30 З / 80 Д" 
                              onClick={() => targetedInfo && window.dispatchEvent(new CustomEvent('plan-build', { detail: 'БАШНЯ' }))} 
                            />
                            <ActionButton 
                              disabled={!targetedInfo}
                              label="Стена" sub="10 З / 50 Д" 
                              onClick={() => targetedInfo && window.dispatchEvent(new CustomEvent('plan-build', { detail: 'СТЕНА' }))} 
                            />
                            <ActionButton 
                              disabled={!targetedInfo}
                              label="Врата" sub="20 З / 60 Д" 
                              onClick={() => targetedInfo && window.dispatchEvent(new CustomEvent('plan-build', { detail: 'ВОРОТА' }))} 
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedEntity.type === 'ЗАМОК' && (
                    <div className="flex gap-2 border-l border-white/10 pl-4 items-center">
                      <ActionButton 
                        label="+Рабочий" 
                        sub="5 З / 10 М" 
                        disabled={!!selectedEntity.underConstruction || !!selectedEntity.trainingUnitType}
                        onClick={() => dispatchAction({ type: 'TRAIN', buildingId: selectedId!, unitType: 'РАБОЧИЙ' })} 
                      />
                    </div>
                  )}

                  {selectedEntity.type === 'КАЗАРМА' && (
                    <div className="flex gap-2 border-l border-white/10 pl-4 items-center">
                      <ActionButton 
                        label={`+${UNIT_STATS[selectedEntity.race]['ВОИН'].name}`} 
                        sub={`${UNIT_STATS[selectedEntity.race]['ВОИН'].cost.ЗОЛОТО} З / ${UNIT_STATS[selectedEntity.race]['ВОИН'].cost.МЯСО} М`} 
                        disabled={!!selectedEntity.underConstruction || !!selectedEntity.trainingUnitType}
                        onClick={() => dispatchAction({ type: 'TRAIN', buildingId: selectedId!, unitType: 'ВОИН' })} 
                      />
                      <ActionButton 
                        label={`+${UNIT_STATS[selectedEntity.race]['ЛУЧНИК'].name}`} 
                        sub={`${UNIT_STATS[selectedEntity.race]['ЛУЧНИК'].cost.ЗОЛОТО} З / ${UNIT_STATS[selectedEntity.race]['ЛУЧНИК'].cost.МЯСО} М`} 
                        disabled={!!selectedEntity.underConstruction || !!selectedEntity.trainingUnitType}
                        onClick={() => dispatchAction({ type: 'TRAIN', buildingId: selectedId!, unitType: 'ЛУЧНИК' })} 
                      />
                    </div>
                  )}

                  {selectedEntity.type === 'АЛТАРЬ' && (
                    <div className="flex gap-2 border-l border-white/10 pl-4 items-center">
                      <ActionButton 
                        label={`+${UNIT_STATS[selectedEntity.race]['ГЕРОЙ'].name}`} 
                        sub={`150 З / 100 М / 70 Д`} 
                        disabled={!!selectedEntity.underConstruction || !!selectedEntity.trainingUnitType || game.entities.some(e => e.ownerId === playerId && (e.type === 'ГЕРОЙ' || e.trainingUnitType === 'ГЕРОЙ'))}
                        onClick={() => dispatchAction({ type: 'TRAIN', buildingId: selectedId!, unitType: 'ГЕРОЙ' })} 
                      />
                    </div>
                  )}

                  {(selectedEntity.type === 'СТЕНА' || selectedEntity.type === 'ВОРОТА') && (
                    <div className="flex gap-2 border-l border-white/10 pl-4 items-center">
                      <ActionButton 
                        label="Повернуть" 
                        sub="на 90° (бесплатно)" 
                        onClick={() => dispatchAction({ type: 'ROTATE', entityId: selectedId!, rotation: ((selectedEntity.rotation || 0) + 90) % 360 })} 
                      />
                    </div>
                  )}
                  
                  <div className="flex-1 text-[10px] text-gray-500 italic px-6 leading-relaxed opacity-60">
                    {targetedInfo ? 'Выберите действие для подтверждения.' : 'Нажмите на карту для выбора цели.'}
                  </div>
               </div>
            ) : (
                <div className="text-gray-500 font-black uppercase tracking-[0.2em] text-sm animate-pulse">
                    {isMyTurn ? 'Юнит чужого игрока' : 'Ждите своей очереди'}
                </div>
            )}
          </div>
        ) : (
          <div className="bg-black/60 backdrop-blur-md px-12 py-3 rounded-t-3xl border-x border-t border-white/10 text-gray-500 text-xs font-bold uppercase tracking-widest">
             Выберите объект для взаимодействия
          </div>
        )}
      </div>
    </div>
  );
}

function PortraitImage({ race, type, color }: { race: string, type: string, color: string }) {
  const [error, setError] = React.useState(false);
  const raceDir = RACE_TO_DIR[race];
  const file = ENTITY_TO_FILE[type];
  const src = `/${raceDir}/${file}.png`;

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center font-black text-white/50 bg-white/5 select-none animate-pulse">
        {type[0]}
      </div>
    );
  }

  return (
    <img 
      src={src} 
      onError={() => setError(true)}
      className="w-full h-full object-cover scale-110 [image-rendering:pixelated]"
      alt={type}
    />
  );
}

function ResourceBadge({ type, amount, color }: { type: string, amount: number, color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase font-black text-gray-600 tracking-tighter">{type}</span>
      <span className={`text-xl font-black ${color} tracking-tight`}>{amount}</span>
    </div>
  );
}

function ActionButton({ label, sub, onClick, accent, disabled }: { label: string, sub: string, onClick?: () => void, accent?: boolean, disabled?: boolean }) {
  return (
    <div className="group relative">
        <button 
           onClick={!disabled ? onClick : undefined}
           className={`border px-5 py-3.5 rounded-2xl transition-all flex flex-col items-center min-w-[140px] pointer-events-auto ${disabled ? 'opacity-30 cursor-not-allowed bg-transparent' : (accent ? 'bg-blue-600 border-white/20 hover:bg-blue-500 shadow-lg shadow-blue-900/40 active:scale-90' : 'bg-white/5 border-white/10 hover:bg-white/10 active:scale-90')}`}
        >
            <span className={`text-sm font-black tracking-tight uppercase ${accent ? 'text-white' : 'text-gray-100'}`}>{label}</span>
            <span className={`text-[9px] font-bold group-hover:text-white/50 ${accent ? 'text-blue-100/60' : 'text-gray-500'}`}>{sub}</span>
        </button>
    </div>
  );
}
