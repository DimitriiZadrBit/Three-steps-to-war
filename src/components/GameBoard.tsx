
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Text, Group, Shape, Line, Image as KonvaImage } from 'react-konva';
import { GameState, GameAction, Entity, ResourceType, EntityType } from '../types.ts';
import { MAP_SIZE, CELL_SIZE, RACE_COLORS, PLAYER_COLORS, UNIT_STATS } from '../constants.ts';

// Simple hook to load images
const imageCache: Record<string, HTMLImageElement> = {};
function useImage(url: string) {
   const [img, setImg] = useState<HTMLImageElement | null>(imageCache[url] || null);
   useEffect(() => {
       if (imageCache[url]) { setImg(imageCache[url]); return; }
       const i = new window.Image();
       i.src = url;
       i.onload = () => { imageCache[url] = i; setImg(i); };
   }, [url]);
   return img;
}

// Hook to force re-renders for animations
function useGlobalTime() {
    const [time, setTime] = useState(Date.now());
    useEffect(() => {
        let frameId: number;
        const tick = () => {
            setTime(Date.now());
            frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, []);
    return time;
}

interface GameBoardProps {
  game: GameState;
  playerId: string;
  dispatchAction: (action: GameAction) => void;
}

export default function GameBoard({ game, playerId, dispatchAction }: GameBoardProps) {
  const stageRef = useRef<any>(null);
  const [scale, setScale] = useState(1.0);
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - (MAP_SIZE * CELL_SIZE) / 2, y: 50 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetCell, setTargetCell] = useState<{x: number, y: number} | null>(null);
  const [pendingBuild, setPendingBuild] = useState<EntityType | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const { grid, entities, players, currentPlayerIndex, actionsRemaining } = game;
  const isMyTurn = players[currentPlayerIndex]?.id === playerId;
  const globalTime = useGlobalTime();
  
  const floorImg = useImage('/floor/ground.png');

  // Listen for build/action planning
  useEffect(() => {
    const handlePlanBuild = (e: any) => {
        if (selectedId && targetCell) {
            dispatchAction({ type: 'BUILD', workerId: selectedId, buildingType: e.detail, x: targetCell.x, y: targetCell.y });
            setTargetCell(null);
        }
    };
    const handlePlanMove = () => {
        if (selectedId && targetCell) {
            dispatchAction({ type: 'MOVE', entityId: selectedId!, x: targetCell.x, y: targetCell.y });
            setTargetCell(null);
        }
    };
    const handlePlanHarvest = () => {
        if (selectedId && targetCell) {
            dispatchAction({ type: 'HARVEST', workerId: selectedId!, x: targetCell.x, y: targetCell.y });
            setTargetCell(null);
        }
    };
    
    window.addEventListener('plan-build', handlePlanBuild);
    window.addEventListener('plan-move', handlePlanMove);
    window.addEventListener('plan-harvest', handlePlanHarvest);
    return () => {
      window.removeEventListener('plan-build', handlePlanBuild);
      window.removeEventListener('plan-move', handlePlanMove);
      window.removeEventListener('plan-harvest', handlePlanHarvest);
    };
  }, [selectedId, targetCell]);

  // Fog of War Calculation
  const visibleCells = useMemo(() => {
    const visible = new Set<string>();
    entities.filter(e => e.ownerId === playerId).forEach(e => {
        const vision = UNIT_STATS[e.race][e.type].vision || 3;
        for (let dy = -vision; dy <= vision; dy++) {
            for (let dx = -vision; dx <= vision; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= vision) {
                    visible.add(`${e.x + dx},${e.y + dy}`);
                }
            }
        }
    });
    return visible;
  }, [entities, playerId]);

  // Center on Castle
  useEffect(() => {
    if (game.status !== 'PLAYING' || game.turnNumber > 1) return;
    
    const myCastle = entities.find(e => e.ownerId === playerId && e.type === 'ЗАМОК');
    if (myCastle) {
       setPosition({
         x: window.innerWidth / 2 - myCastle.x * CELL_SIZE * scale,
         y: window.innerHeight / 2 - myCastle.y * CELL_SIZE * scale
       });
    }
  }, [game.status, entities.length, playerId]);

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    
    // Calculate min scale to fit map
    const minScaleW = window.innerWidth / (MAP_SIZE * CELL_SIZE);
    const minScaleH = window.innerHeight / (MAP_SIZE * CELL_SIZE);
    const minScale = Math.max(minScaleW, minScaleH, 0.4); // Don't go too small, but try to fit

    const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
    const boundedScale = Math.min(Math.max(newScale, minScale), 4);
    setScale(boundedScale);
    setPosition({ x: pointer.x - mousePointTo.x * boundedScale, y: pointer.y - mousePointTo.y * boundedScale });
  };

  const handleInteraction = (x: number, y: number) => {
    const cell = grid[y]?.[x];
    if (!cell) return;
    
    // Prioritize units over buildings for better interaction
    const sortedEntitiesOnCell = entities
        .filter(e => e.x === x && e.y === y)
        .sort((a, b) => {
            const isUnitA = !['ЗАМОК', 'КАЗАРМА', 'СТЕНА', 'БАШНЯ', 'ВОРОТА'].includes(a.type);
            const isUnitB = !['ЗАМОК', 'КАЗАРМА', 'СТЕНА', 'БАШНЯ', 'ВОРОТА'].includes(b.type);
            if (isUnitA && !isUnitB) return -1;
            if (!isUnitA && isUnitB) return 1;
            return 0;
        });

    const clickedEntity = sortedEntitiesOnCell[0];
    
    if (selectedId) {
        const selectedEntity = entities.find(e => e.id === selectedId);
        if (selectedEntity && selectedEntity.ownerId === playerId && isMyTurn && actionsRemaining > 0) {
            
            // Check if we clicked our own gate AND we have a mobile unit selected (allow targeting the gate for passing)
            let isTargetingGate = false;
            if (
                clickedEntity &&
                clickedEntity.type === 'ВОРОТА' &&
                clickedEntity.ownerId === playerId &&
                clickedEntity.id !== selectedId &&
                !['ЗАМОК', 'КАЗАРМА', 'СТЕНА', 'БАШНЯ', 'ВОРОТА'].includes(selectedEntity.type)
            ) {
                // If it's adjacent, let them target it to pass through
                if (Math.abs(selectedEntity.x - x) <= 1 && Math.abs(selectedEntity.y - y) <= 1) {
                    isTargetingGate = true;
                }
            }

            // If we clicked a FRIENDLY entity that is NOT the same as selected, SELECT IT instead of targeting
            if (clickedEntity && clickedEntity.ownerId === playerId && clickedEntity.id !== selectedId && !isTargetingGate) {
                // Change selection
                setTargetCell(null);
                setPendingBuild(null);
                setPendingAction(null);
                window.dispatchEvent(new CustomEvent('cell-targeted', { detail: null }));
                setSelectedId(clickedEntity.id);
                window.dispatchEvent(new CustomEvent('cell-entity-selected', { detail: clickedEntity.id }));
                return;
            }

            // Normal targeting behavior (empty cell, resource, enemy, or friendly gate)
            if (!clickedEntity || clickedEntity.id !== selectedId || isTargetingGate) {
                setTargetCell({x, y});
                window.dispatchEvent(new CustomEvent('cell-targeted', { 
                    detail: { 
                        x, y, 
                        hasResource: !!cell.resource, 
                        isGate: isTargetingGate, 
                        entityId: clickedEntity?.id,
                        isEnemy: clickedEntity && clickedEntity.ownerId !== playerId 
                    } 
                }));
                return;
            }
        }
    }

    // Default Selection (nothing selected yet or clicked the same thing)
    setTargetCell(null);
    setPendingBuild(null);
    setPendingAction(null);
    window.dispatchEvent(new CustomEvent('cell-targeted', { detail: null }));
    if (clickedEntity) {
        setSelectedId(clickedEntity.id);
        window.dispatchEvent(new CustomEvent('cell-entity-selected', { detail: clickedEntity.id }));
    } else {
        setSelectedId(null);
        window.dispatchEvent(new CustomEvent('cell-entity-selected', { detail: null }));
    }
  };

  return (
    <Stage
      width={window.innerWidth} height={window.innerHeight}
      ref={stageRef} draggable onWheel={handleWheel}
      x={position.x} y={position.y} scaleX={scale} scaleY={scale}
      className="bg-[#3d2b1f]"
      onClick={(e) => {
        if (e.target === e.target.getStage()) {
          const pos = stageRef.current.getRelativePointerPosition();
          if (pos) handleInteraction(Math.floor(pos.x / CELL_SIZE), Math.floor(pos.y / CELL_SIZE));
        }
      }}
    >
      <Layer>
        {/* Terrain/Fog Layer */}
        {grid.map((row, y) => row.map((cell, x) => {
            const isVisible = visibleCells.has(`${x},${y}`);
            const isTargeted = targetCell?.x === x && targetCell?.y === y;
            return (
                <Group key={`cell-${x}-${y}`} x={x * CELL_SIZE} y={y * CELL_SIZE} onClick={() => handleInteraction(x, y)}>
                    {isVisible ? (
                        <Rect
                           width={CELL_SIZE} height={CELL_SIZE}
                           fill={floorImg ? 'transparent' : '#5c3d2e'}
                        />
                    ) : (
                        <Rect
                           width={CELL_SIZE} height={CELL_SIZE}
                           fill="#261a14"
                        />
                    )}
                    {isVisible && floorImg && (
                        <KonvaImage 
                            image={floorImg} 
                            width={CELL_SIZE} 
                            height={CELL_SIZE} 
                            opacity={1}
                        />
                    )}
                    <Rect
                        width={CELL_SIZE} height={CELL_SIZE}
                        stroke={isTargeted ? '#3b82f688' : "#382419"} 
                        strokeWidth={1}
                        listening={false}
                    />
                    {isTargeted && <Rect width={CELL_SIZE} height={CELL_SIZE} fill="#3b82f644" listening={false} />}
                </Group>
            );
        }))}

        {/* Resources Layer (only visible) */}
        {grid.map((row, y) => row.map((cell, x) => (
          cell.resource && visibleCells.has(`${x},${y}`) && (
              <ResourceIcon key={`res-${x}-${y}`} cell={cell} />
          )
        )))}

        {/* Entities Layer (only visible) */}
        {entities.map(entity => {
            const isVisible = visibleCells.has(`${entity.x},${entity.y}`);
            if (!isVisible && entity.ownerId !== playerId) return null;
            return (
              <EntityMarker 
                key={entity.id} 
                entity={entity} 
                players={players}
                isSelected={entity.id === selectedId}
                time={globalTime}
                onClick={() => handleInteraction(entity.x, entity.y)}
              />
            );
        })}
      </Layer>
    </Stage>
  );
}

function ResourceIcon({ cell }: { cell: any }) {
    const amount = cell.resourceAmount || 0;
    const size = CELL_SIZE * 0.22;
    const offset = (CELL_SIZE - size) / 2;

    return (
        <Group x={cell.x * CELL_SIZE + offset} y={cell.y * CELL_SIZE + offset}>
            {cell.resource === 'ЗОЛОТО' && (
                <Group>
                    <Rect width={size*0.8} height={size*0.6} y={size*0.2} fill="#713f12" cornerRadius={2} />
                    <Rect width={size*0.6} height={size*0.4} x={size*0.1} y={size*0.1} fill="#eab308" stroke="#ca8a04" strokeWidth={1} />
                    <Rect width={12} height={4} x={size*0.2} y={size*0.2} fill="#fde047" />
                    <Rect width={12} height={4} x={size*0.4} y={size*0.4} fill="#fde047" />
                </Group>
            )}
            {cell.resource === 'ДЕРЕВО' && (
                <Group>
                    <Rect width={size*0.2} height={size*0.8} x={size*0.4} y={size*0.1} fill="#78350f" cornerRadius={1} />
                    <Circle radius={size*0.3} x={size*0.5} y={size*0.3} fill="#15803d" stroke="#052e16" strokeWidth={0.5} />
                    <Circle radius={size*0.2} x={size*0.3} y={size*0.4} fill="#166534" />
                    <Circle radius={size*0.2} x={size*0.7} y={size*0.4} fill="#166534" />
                </Group>
            )}
            {cell.resource === 'МЯСО' && (
                <Group>
                    <Rect width={size*0.6} height={size*0.5} x={size*0.2} y={size*0.2} fill="#ef4444" cornerRadius={10} stroke="#991b1b" />
                    <Rect width={size*0.2} height={12} x={size*0.1} y={size*0.3} fill="#f1f5f9" cornerRadius={2} rotation={-45} />
                    <Rect width={size*0.2} height={4} x={size*0.25} y={size*0.35} fill="#fecaca" />
                </Group>
            )}
            <Text 
                text={`${amount}`} 
                x={-offset} y={CELL_SIZE - 12 - offset} 
                width={CELL_SIZE}
                align="center"
                fill="white" fontSize={10} fontStyle="bold" 
                shadowBlur={4} shadowColor="black"
            />
        </Group>
    );
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

export function getEntitySize(type: string): number {
    if (type === 'ЗАМОК') return CELL_SIZE * 1.35;
    if (type === 'БАШНЯ') return CELL_SIZE * 1.5; 
    if (type === 'КАЗАРМА') return CELL_SIZE * 1.3;
    if (type === 'АЛТАРЬ') return CELL_SIZE * 1.3;
    if (type === 'ВОРОТА') return CELL_SIZE * 1.25; 
    if (type === 'СТЕНА') return CELL_SIZE * 1.25;
    if (type === 'ГЕРОЙ') return CELL_SIZE * 0.9;
    if (type === 'РАБОЧИЙ') return CELL_SIZE * 0.6;
    if (type === 'ВОИН') return CELL_SIZE * 0.7;
    if (type === 'ЛУЧНИК') return CELL_SIZE * 0.7;
    if (type === 'ОСАДНОЕ') return CELL_SIZE * 0.75;
    return CELL_SIZE * 0.9;
}

function UniversalEntityVisual({ entity, playerColor, time, isSelected }: { entity: Entity, playerColor: string, time: number, isSelected: boolean }) {
    const raceDir = RACE_TO_DIR[entity.race];
    const fileName = ENTITY_TO_FILE[entity.type];
    const imgSrc = `/${raceDir}/${fileName}.png`;
    const userImg = useImage(imgSrc);

    const size = getEntitySize(entity.type);
    const offset = (CELL_SIZE - size) / 2;

    if (userImg) {
        return (
            <Group x={offset} y={offset}>
                <KonvaImage 
                    image={userImg} 
                    width={size} 
                    height={size} 
                    y={isSelected ? Math.sin(time/300)*2 : 0}
                />
                {/* Harvesting Effect */}
                {entity.lastActionType === 'HARVEST' && (
                    <Group y={-15 - (Math.sin(time/100) * 5)}>
                        <Text text="⛏️" fontSize={16} x={size/2 - 8} />
                        <Circle radius={12} x={size/2} y={8} fill="#facc15" opacity={0.2} shadowBlur={10} shadowColor="#facc15" />
                    </Group>
                )}
            </Group>
        );
    }

    // Fallbacks if image not uploaded
    if (entity.type === 'ЗАМОК') return <CastleVisual race={entity.race} playerColor={playerColor} />;
    if (entity.type === 'КАЗАРМА') return <BarracksVisual race={entity.race} playerColor={playerColor} />;
    if (entity.type === 'ВОРОТА') return <GateVisual race={entity.race} playerColor={playerColor} />;
    
    return (
        <Group x={offset} y={offset}>
            <Rect
                width={size} height={size}
                fill={RACE_COLORS[entity.race as any]} cornerRadius={4}
                stroke={playerColor} strokeWidth={2}
                shadowBlur={5} shadowColor={playerColor} shadowOpacity={0.8}
            />
            <Text 
                text={entity.type[0]} fill="white" fontSize={12} fontStyle="black"
                x={size * 0.3} y={size * 0.3}
            />
        </Group>
    );
}

function EntityMarker({ entity, players, isSelected, time, onClick }: { entity: Entity, players: any[], isSelected: boolean, time: number, onClick: () => void }) {
  const raceColor = RACE_COLORS[entity.race];
  const pIdx = players.findIndex(p => p.id === entity.ownerId);
  const playerColor = pIdx >= 0 ? PLAYER_COLORS[pIdx % 4] : '#ccc';

  const size = getEntitySize(entity.type);
  const offset = (CELL_SIZE - size) / 2;
  const hpY = offset - 6;

  return (
    <Group x={entity.x * CELL_SIZE} y={entity.y * CELL_SIZE} onClick={onClick}>
      {isSelected && (
        <Circle 
           radius={CELL_SIZE * 0.45} x={CELL_SIZE/2} y={CELL_SIZE/2}
           stroke={playerColor} strokeWidth={1} opacity={0.6}
           dash={[2, 2]}
        />
      )}

      {/* Rotatable components */}
      <Group
        x={CELL_SIZE/2} y={CELL_SIZE/2}
        offsetX={CELL_SIZE/2} offsetY={CELL_SIZE/2}
        rotation={entity.rotation || 0}
      >
        {entity.underConstruction && (
            <Group>
                <Rect width={CELL_SIZE * 0.8} height={CELL_SIZE * 0.8} x={CELL_SIZE * 0.1} y={CELL_SIZE * 0.1} fill="#555" opacity={0.5} stroke="#fff" dash={[2, 2]} />
                {/* Construction Scaffolding lines */}
                <Shape sceneFunc={(ctx, shape) => {
                    ctx.beginPath();
                    ctx.moveTo(CELL_SIZE*0.2, CELL_SIZE*0.8);
                    ctx.lineTo(CELL_SIZE*0.8, CELL_SIZE*0.8);
                    ctx.moveTo(CELL_SIZE*0.3, CELL_SIZE*0.8);
                    ctx.lineTo(CELL_SIZE*0.3, CELL_SIZE*0.3);
                    ctx.moveTo(CELL_SIZE*0.7, CELL_SIZE*0.8);
                    ctx.lineTo(CELL_SIZE*0.7, CELL_SIZE*0.5);
                    ctx.moveTo(CELL_SIZE*0.3, CELL_SIZE*0.5);
                    ctx.lineTo(CELL_SIZE*0.7, CELL_SIZE*0.5);
                    ctx.strokeShape(shape);
                }} stroke="#fcd34d" strokeWidth={2} />
            </Group>
        )}
        {!entity.underConstruction && (
           <UniversalEntityVisual entity={entity} playerColor={playerColor} time={time} isSelected={isSelected} />
        )}
      </Group>

      {/* Non-rotatable status text */}
      {entity.underConstruction && (
          <Group>
             <Rect width={CELL_SIZE * 0.9} height={CELL_SIZE * 0.4} x={CELL_SIZE * 0.05} y={CELL_SIZE * 0.3} fill="rgba(0,0,0,0.7)" cornerRadius={4} />
             <Text text={`СТРОЙКА\n${entity.constructionTurnsLeft} ход`} fill="#fcd34d" fontStyle="bold" fontSize={10} x={CELL_SIZE * 0.05} y={CELL_SIZE * 0.35} width={CELL_SIZE * 0.9} align="center" shadowColor="black" shadowBlur={4} />
             
             {/* Animated Hammer */}
             <Group x={CELL_SIZE*0.7} y={CELL_SIZE*0.25} rotation={Math.sin(time/150) * 20}>
                 <Rect width={4} height={14} fill="#8b5cf6" />
                 <Rect width={12} height={6} x={-4} y={0} fill="#d1d5db" cornerRadius={1} />
             </Group>
          </Group>
      )}

      {entity.lastActionType === 'HARVEST' && time - (entity.lastActionTime || 0) < 3000 && (
          <Group y={CELL_SIZE * 0.1}>
            <Circle radius={10} x={CELL_SIZE * 0.8} y={10} fill="white" opacity={0.8} shadowBlur={2} />
            {entity.lastHarvestResource === 'ДЕРЕВО' && (
                <Group x={CELL_SIZE * 0.8} y={10} scaleX={0.6} scaleY={0.6} offsetX={10} offsetY={10} rotation={Math.sin(time/100) * 35}>
                    <Rect width={4} height={15} x={8} y={2} fill="#78350f" />
                    <Rect width={14} height={8} x={1} y={1} fill="#94a3b8" cornerRadius={2} />
                </Group>
            )}
            {entity.lastHarvestResource === 'МЯСО' && (
                <Group x={CELL_SIZE * 0.8} y={10} scaleX={0.6} scaleY={0.6} offsetX={10} offsetY={10} rotation={-Math.abs(Math.sin(time/150) * 45)}>
                    <Rect width={14} height={8} x={3} y={1} fill="#9ca3af" />
                    <Circle radius={4} x={17} y={5} fill="#475569" />
                    <Rect width={4} height={10} x={8} y={9} fill="#78350f" />
                </Group>
            )}
            {entity.lastHarvestResource === 'ЗОЛОТО' && (
                <Group x={CELL_SIZE * 0.8} y={10} scaleX={0.6} scaleY={0.6} offsetX={10} offsetY={10} rotation={Math.sin(time/120) * 40}>
                    <Rect width={4} height={20} x={8} y={0} fill="#78350f" rotation={45} />
                    <Rect width={16} height={4} x={0} y={8} fill="#ca8a04" rotation={45} />
                </Group>
            )}
            <Text text="+50" x={CELL_SIZE * 0.8 - 10} y={22} fill="#10b981" fontStyle="bold" fontSize={10} shadowColor="black" shadowBlur={2} />
          </Group>
      )}

      {(entity.trainingTurnsLeft || 0) > 0 && (
         <Group>
            <Circle radius={8} x={CELL_SIZE - 10} y={10} fill="#3b82f6" stroke="#fff" strokeWidth={1} />
            <Text text={entity.trainingTurnsLeft.toString()} x={CELL_SIZE - 14} y={6} fill="white" width={8} align="center" fontStyle="bold" fontSize={9} />
            <Text text="НАЙМ..." fill="#60a5fa" fontStyle="bold" fontSize={8} x={CELL_SIZE * 0.1} y={CELL_SIZE * 0.85} width={CELL_SIZE * 0.8} align="center" shadowColor="black" shadowBlur={2} />
         </Group>
      )}

      {/* Fire effect when taking too much damage */}
      {['ЗАМОК', 'КАЗАРМА', 'СТЕНА', 'БАШНЯ', 'ВОРОТА'].includes(entity.type) && entity.hp <= 200 && (
         <Group x={CELL_SIZE/2} y={CELL_SIZE/2}>
             <Circle radius={10} fill="#ef4444" opacity={0.6 + Math.sin(time/50)*0.2} shadowBlur={15} shadowColor="#ef4444" />
             <Shape 
                sceneFunc={(ctx, shape) => {
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    const dy = Math.sin(time/100) * 5;
                    const dx = Math.cos(time/50) * 3;
                    ctx.lineTo(-8, 5);
                    ctx.lineTo(dx, -15 - dy);
                    ctx.lineTo(8, 5);
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                }} 
                fill="#f59e0b" 
                opacity={0.8}
             />
         </Group>
      )}

      {/* HP Indicators */}
      {entity.hp < entity.maxHp ? (
          <Group y={hpY}>
            <Rect width={CELL_SIZE * 0.8} height={8} x={CELL_SIZE * 0.1} fill="#111" cornerRadius={2} />
            <Rect 
                width={CELL_SIZE * 0.8 * (Math.max(0, entity.hp) / entity.maxHp)} 
                height={8} x={CELL_SIZE * 0.1} 
                fill={entity.hp <= 200 ? "#ef4444" : "#22c55e"} cornerRadius={2} 
            />
            <Text 
                text={`${entity.hp}/${entity.maxHp}`}
                x={CELL_SIZE * 0.1} width={CELL_SIZE * 0.8}
                y={1} align="center" fontSize={6} fill="white" fontStyle="bold"
            />
          </Group>
      ) : (
          <Group y={hpY}>
            <Rect width={CELL_SIZE * 0.8} height={4} x={CELL_SIZE * 0.1} fill="#111" cornerRadius={2} />
            <Rect 
                width={CELL_SIZE * 0.8} 
                height={4} x={CELL_SIZE * 0.1} 
                fill="#22c55e" cornerRadius={2} 
            />
          </Group>
      )}
    </Group>
  );
}

function BarracksVisual({ race, playerColor }: { race: string, playerColor: string }) {
    const color = RACE_COLORS[race as any];
    
    if (race === 'НЕЖИТЬ') {
        const baseSize = CELL_SIZE * 0.8;
        const offset = (CELL_SIZE - baseSize) / 2;
        return (
            <Group x={offset} y={offset}>
                {/* Stone Base Layer */}
                <Rect width={baseSize} height={baseSize} fill="#1c1917" stroke="#444" strokeWidth={1} cornerRadius={4} />
                <Rect width={baseSize * 0.9} height={baseSize * 0.9} x={baseSize * 0.05} y={baseSize * 0.05} stroke="#5b21b6" strokeWidth={1} opacity={0.3} />
                
                {/* Dark Stone Structure */}
                <Rect width={baseSize * 0.7} height={baseSize * 0.7} x={baseSize * 0.15} y={baseSize * 0.15} fill="#1a1a1a" stroke="#000" strokeWidth={1} />
                
                {/* Purple Roof Tiers */}
                <Rect width={baseSize * 0.5} height={baseSize * 0.5} x={baseSize * 0.25} y={baseSize * 0.25} fill="#4c1d95" stroke="#000" strokeWidth={0.5} />
                <Rect width={baseSize * 0.3} height={baseSize * 0.3} x={baseSize * 0.35} y={baseSize * 0.35} fill="#5b21b6" stroke="#000" strokeWidth={0.5} />
                
                {/* Corner Decoration (Skulls/Orbs) */}
                {[ {x:0, y:0}, {x:baseSize-8, y:0}, {x:0, y:baseSize-8}, {x:baseSize-8, y:baseSize-8} ].map((p, i) => (
                    <Rect key={i} x={p.x} y={p.y} width={8} height={8} fill="#262626" stroke="#fbbf24" strokeWidth={0.5} />
                ))}

                {/* Central Point */}
                <Circle x={baseSize/2} y={baseSize/2} radius={3} fill="#fbbf24" shadowBlur={4} shadowColor="#fbbf24" />
            </Group>
        );
    }

    return (
        <Group>
            <Rect width={CELL_SIZE * 0.8} height={CELL_SIZE * 0.8} x={CELL_SIZE * 0.1} y={CELL_SIZE * 0.1} fill={color} stroke={playerColor} strokeWidth={2} shadowBlur={10} shadowColor={playerColor} />
            <Text text="К" fill="white" fontSize={24} fontStyle="black" x={CELL_SIZE * 0.3} y={CELL_SIZE * 0.25} />
        </Group>
    );
}

function GateVisual({ race, playerColor }: { race: string, playerColor: string }) {
    const color = RACE_COLORS[race as any];
    return (
        <Group x={CELL_SIZE*0.1} y={CELL_SIZE*0.1}>
            <Rect width={10} height={CELL_SIZE*0.8} fill="#333" stroke={playerColor} strokeWidth={1} />
            <Rect width={10} height={CELL_SIZE*0.8} x={CELL_SIZE*0.8 - 10} fill="#333" stroke={playerColor} strokeWidth={1} />
            <Rect width={CELL_SIZE*0.6} height={CELL_SIZE*0.6} x={10} y={CELL_SIZE*0.1} fill={color} opacity={0.4} stroke={playerColor} dash={[2, 2]} />
            <Rect width={2} height={CELL_SIZE*0.8} x={CELL_SIZE*0.4 - 1} fill="white" opacity={0.3} />
        </Group>
    );
}

function CastleVisual({ race, playerColor }: { race: string, playerColor: string }) {
    const color = RACE_COLORS[race as any];
    
    if (race === 'ОРКИ') {
        return (
            <Group>
                <Rect width={CELL_SIZE * 0.8} height={CELL_SIZE * 0.8} x={CELL_SIZE * 0.1} y={CELL_SIZE * 0.1} fill={color} stroke={playerColor} strokeWidth={3} />
                {/* Spikes */}
                <Shape sceneFunc={(ctx, shape) => {
                    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(10,-20); ctx.lineTo(20,0); ctx.closePath(); ctx.fillStrokeShape(shape);
                }} fill="#444" stroke="#000" x={CELL_SIZE*0.2} y={15} scaleX={0.5} scaleY={0.5} />
                <Shape sceneFunc={(ctx, shape) => {
                    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(10,-20); ctx.lineTo(20,0); ctx.closePath(); ctx.fillStrokeShape(shape);
                }} fill="#444" stroke="#000" x={CELL_SIZE*0.7} y={15} scaleX={0.5} scaleY={0.5} />
            </Group>
        );
    }

    if (race === 'ЛЮДИ') {
        const baseSize = CELL_SIZE * 0.8;
        return (
            <Group x={CELL_SIZE*0.1} y={CELL_SIZE*0.1}>
                {/* Stone Keep */}
                <Rect width={baseSize} height={baseSize} fill="#d1d5db" stroke="#4b5563" strokeWidth={2} cornerRadius={2} />
                {/* Blue Roof */}
                <Rect width={baseSize*0.6} height={baseSize*0.6} x={baseSize*0.2} y={baseSize*0.2} fill="#1d4ed8" stroke="#000" />
                {/* Towers */}
                {[ {x:0, y:0}, {x:baseSize-10, y:0}, {x:0, y:baseSize-10}, {x:baseSize-10, y:baseSize-10} ].map((p, i) => (
                    <Rect key={i} x={p.x} y={p.y} width={10} height={10} fill="#9ca3af" stroke="#000" />
                ))}
            </Group>
        );
    }
    
    if (race === 'НЕЖИТЬ') {
        const baseSize = CELL_SIZE * 0.9;
        const offset = (CELL_SIZE - baseSize) / 2;
        return (
            <Group x={offset} y={offset}>
                {/* Deep Chasm / Foundation */}
                <Rect width={baseSize} height={baseSize} fill="#0c0a09" stroke="#4c1d95" strokeWidth={2} cornerRadius={4} />
                
                {/* Tier 1: Main Platform */}
                <Rect width={baseSize * 0.8} height={baseSize * 0.8} x={baseSize * 0.1} y={baseSize * 0.1} fill="#1c1917" stroke="#444" strokeWidth={1} />
                
                {/* Tier 2: Elevated Core */}
                <Rect width={baseSize * 0.6} height={baseSize * 0.6} x={baseSize * 0.2} y={baseSize * 0.2} fill="#262626" stroke="#5b21b6" strokeWidth={1} />

                {/* Spires at corners */}
                {[ {x:0, y:0}, {x:baseSize-12, y:0}, {x:0, y:baseSize-12}, {x:baseSize-12, y:baseSize-12} ].map((p, i) => (
                    <Group key={i} x={p.x} y={p.y}>
                        <Rect width={12} height={12} fill="#171717" stroke="#ef4444" strokeWidth={0.5} />
                        <Rect width={4} height={4} x={4} y={4} fill="#ef4444" shadowBlur={5} shadowColor="#ef4444" />
                    </Group>
                ))}

                {/* Central Crypt / Mausoleum */}
                <Rect width={baseSize * 0.3} height={baseSize * 0.4} x={baseSize * 0.35} y={baseSize * 0.3} fill="#441111" stroke="#991b1b" strokeWidth={1} />
                <Rect width={2} height={baseSize * 0.4} x={baseSize * 0.5 - 1} y={baseSize * 0.3} fill="#ef4444" opacity={0.6} />

                {/* Purple Energy Vortex on top */}
                <Circle x={baseSize/2} y={baseSize/2} radius={baseSize*0.15} fillRadialGradientColorStops={[0, '#7c3aed', 1, 'transparent']} opacity={0.4} />

                {/* Ancient Skulls on Spires */}
                {[ {x:baseSize*0.2, y:baseSize*0.2}, {x:baseSize*0.8, y:baseSize*0.2}, {x:baseSize*0.2, y:baseSize*0.8}, {x:baseSize*0.8, y:baseSize*0.8} ].map((p, i) => (
                    <Circle key={`skull-${i}`} x={p.x} y={p.y} radius={2} fill="#f1f5f9" stroke="#000" strokeWidth={0.5} />
                ))}

                {/* Glowing Green Souls escaping */}
                <Circle x={baseSize * 0.3} y={baseSize * 0.4} radius={1.5} fill="#22c55e" shadowBlur={10} shadowColor="#22c55e" />
                <Circle x={baseSize * 0.7} y={baseSize * 0.6} radius={1.5} fill="#22c55e" shadowBlur={10} shadowColor="#22c55e" />
            </Group>
        );
    }
    
    return (
        <Rect width={CELL_SIZE * 0.9} height={CELL_SIZE * 0.9} x={CELL_SIZE * 0.05} y={CELL_SIZE * 0.05} fill={color} cornerRadius={6} stroke={playerColor} strokeWidth={3} />
    );
}
