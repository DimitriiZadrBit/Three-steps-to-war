
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GameState, GameAction, Player, Race, Entity, EntityType, ResourceType } from './src/types.ts';
import { MAP_SIZE, INITIAL_RESOURCES, UNIT_STATS, PLAYER_COLORS } from './src/constants.ts';
import { nanoid } from 'nanoid';

const PORT = 3000;

async function start() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);

  // Game state (Single session for demo, could be multi-room)
  let game: GameState = {
    id: nanoid(),
    grid: [],
    entities: [],
    players: [],
    currentPlayerIndex: 0,
    actionsRemaining: 3,
    turnNumber: 1,
    status: 'LOBBY',
    visibleCells: [],
  };

  const initGrid = (startPositions: {x: number, y: number}[]) => {
    const grid = [];
    for (let y = 0; y < MAP_SIZE; y++) {
      const row = [];
      for (let x = 0; x < MAP_SIZE; x++) {
        row.push({ x, y });
      }
      grid.push(row);
    }

    // Guaranteed spawns near each castle (1 gold, 1 wood, 1 meat)
    startPositions.forEach(pos => {
      // Place explicitly 4 cells away in cardinal directions to avoid overlap
      const nearPositions = [
        { dx: 4, dy: 0 }, // ЗОЛОТО
        { dx: -4, dy: 0 }, // ДЕРЕВО
        { dx: 0, dy: 4 }  // МЯСО
      ];
      
      const types: (ResourceType)[] = ['ЗОЛОТО', 'ДЕРЕВО', 'МЯСО'];
      types.forEach((type, i) => {
        const offset = nearPositions[i];
        const rx = Math.max(0, Math.min(MAP_SIZE - 1, pos.x + offset.dx));
        const ry = Math.max(0, Math.min(MAP_SIZE - 1, pos.y + offset.dy));
        grid[ry][rx].resource = type;
        grid[ry][rx].resourceAmount = 400;
      });
    });

    // Random resources dispersed throughout the map
    const maxAdditionalNodes = 70; // Increased to make resources easier to find (5-6 turns out)
    let placed = 0;
    for (let i = 0; i < 400 && placed < maxAdditionalNodes; i++) {
        const x = Math.floor(Math.random() * MAP_SIZE);
        const y = Math.floor(Math.random() * MAP_SIZE);
        
        if (grid[y][x].resource) continue;

        // Ensure they don't spawn right next to the initial player bases, but close enough (5-6 cells away)
        const tooCloseToStarts = startPositions.some(pos => Math.max(Math.abs(pos.x - x), Math.abs(pos.y - y)) < 5);
        if (tooCloseToStarts) continue;

        // Ensure identical resources don't spawn next to each other
        const neighbors = [
            {dx: -1, dy: 0}, {dx: 1, dy: 0}, {dx: 0, dy: -1}, {dx: 0, dy: 1},
            {dx: -1, dy: -1}, {dx: 1, dy: -1}, {dx: -1, dy: 1}, {dx: 1, dy: 1}
        ];
        
        let neighborRes = new Set<string>();
        neighbors.forEach(n => {
            const nx = x + n.dx;
            const ny = y + n.dy;
            if (nx >= 0 && nx < MAP_SIZE && ny >= 0 && ny < MAP_SIZE && grid[ny][nx].resource) {
                neighborRes.add(grid[ny][nx].resource as string);
            }
        });

        const validTypes = ['ЗОЛОТО', 'ДЕРЕВО', 'МЯСО'].filter(r => !neighborRes.has(r));
        if (validTypes.length === 0) continue; // Skip if completely surrounded by all types, unlikely but safe

        const resType = validTypes[Math.floor(Math.random() * validTypes.length)] as any;
        grid[y][x].resource = resType;
        grid[y][x].resourceAmount = 400;
        placed++;
    }
    return grid;
  };

  const updateVisibility = () => {
    const activePlayer = game.players[game.currentPlayerIndex];
    const visible = new Set<string>();
    
    // Units and buildings provide vision
    game.entities.forEach(e => {
        if (e.ownerId === activePlayer.id) {
            const vision = UNIT_STATS[e.race][e.type].vision || 5;
            for (let dy = -vision; dy <= vision; dy++) {
                for (let dx = -vision; dx <= vision; dx++) {
                    const vx = e.x + dx;
                    const vy = e.y + dy;
                    if (vx >= 0 && vx < MAP_SIZE && vy >= 0 && vy < MAP_SIZE) {
                        visible.add(`${vx},${vy}`);
                    }
                }
            }
        }
    });
    game.visibleCells = Array.from(visible);
  };

  const broadcastGame = () => {
    updateVisibility();
    io.emit('game:update', game);
  };

  const startGame = () => {
    const startPositions = [
        { x: 5, y: 5 },
        { x: MAP_SIZE - 6, y: 5 },
        { x: Math.floor(MAP_SIZE / 2), y: MAP_SIZE - 6 }
    ];

    game.grid = initGrid(startPositions);
    game.entities = [];
    game.status = 'PLAYING';
    game.currentPlayerIndex = 0;
    game.actionsRemaining = 3;
    game.turnNumber = 1;
    
    game.players.forEach((p, idx) => {
        const pos = startPositions[idx % startPositions.length];
        const castle: Entity = {
            id: `castle-${p.id}`,
            type: 'ЗАМОК',
            race: p.race,
            ownerId: p.id,
            x: pos.x,
            y: pos.y,
            hp: UNIT_STATS[p.race].ЗАМОК.hp,
            maxHp: UNIT_STATS[p.race].ЗАМОК.hp,
            actionsPerformedThisTurn: 0,
        };
        const worker: Entity = {
            id: `worker-init-${p.id}`,
            type: 'РАБОЧИЙ',
            race: p.race,
            ownerId: p.id,
            x: pos.x,
            y: pos.y + 1,
            hp: UNIT_STATS[p.race].РАБОЧИЙ.hp,
            maxHp: UNIT_STATS[p.race].РАБОЧИЙ.hp,
            actionsPerformedThisTurn: 0,
        };
        game.entities.push(castle, worker);
    });

    broadcastGame();
    if (game.players[0].isBot) setTimeout(() => triggerBotTurn(), 1000);
  };

  const checkStart = () => {
    // No auto-start
  };

  const processTowerAttacks = (playerId: string) => {
    const playerTowers = game.entities.filter(e => e.ownerId === playerId && e.type === 'БАШНЯ' && !e.underConstruction);
    playerTowers.forEach(tower => {
        if (tower.targetEntityId) {
            const target = game.entities.find(e => e.id === tower.targetEntityId);
            if (target) {
                const dist = Math.max(Math.abs(tower.x - target.x), Math.abs(tower.y - target.y));
                const range = UNIT_STATS[tower.race].БАШНЯ.range || 5;
                if (dist <= range) {
                    const damage = UNIT_STATS[tower.race].БАШНЯ.attack || 25;
                    target.hp -= damage;
                    if (target.hp <= 0) {
                        game.entities = game.entities.filter(e => e.id !== target.id);
                        if (target.type === 'ЗАМОК') game.status = 'FINISHED';
                    }
                } else {
                    tower.targetEntityId = undefined; 
                }
            } else {
                tower.targetEntityId = undefined; 
            }
        }
    });
  };

  const tickPlayerTimers = (playerId: string) => {
    for (const entity of game.entities) {
        if (entity.ownerId === playerId) {
            if (entity.justStartedTimer) {
                entity.justStartedTimer = false;
                continue;
            }

            if (entity.underConstruction && entity.constructionTurnsLeft && entity.constructionTurnsLeft > 0) {
                entity.constructionTurnsLeft--;
                if (entity.constructionTurnsLeft === 0) {
                    entity.underConstruction = false;
                }
            }

            if (entity.trainingTurnsLeft && entity.trainingTurnsLeft > 0) {
                entity.trainingTurnsLeft--;
                if (entity.trainingTurnsLeft === 0 && entity.trainingUnitType) {
                    // Try to spawn the unit
                    let spawnPos = null;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const sx = entity.x + dx;
                            const sy = entity.y + dy;
                            if (sx >= 0 && sx < MAP_SIZE && sy >= 0 && sy < MAP_SIZE) {
                                if (!game.entities.some(e => e.x === sx && e.y === sy)) {
                                    spawnPos = { x: sx, y: sy };
                                    break;
                                }
                            }
                        }
                        if (spawnPos) break;
                    }

                    if (spawnPos) {
                        game.entities.push({
                            id: nanoid(),
                            type: entity.trainingUnitType,
                            race: entity.race,
                            ownerId: playerId,
                            x: spawnPos.x,
                            y: spawnPos.y,
                            hp: UNIT_STATS[entity.race][entity.trainingUnitType].hp,
                            maxHp: UNIT_STATS[entity.race][entity.trainingUnitType].hp,
                            actionsPerformedThisTurn: 0,
                        });
                    }
                    
                    entity.trainingTurnsLeft = 0;
                    entity.trainingUnitType = undefined;
                }
            }
        }
    }
  };

  const triggerBotTurn = () => {
    const activePlayer = game.players[game.currentPlayerIndex];
    if (activePlayer && activePlayer.isBot) {
        setTimeout(() => {
            tickPlayerTimers(activePlayer.id);
            tickPlayerTimers(activePlayer.id);
            tickPlayerTimers(activePlayer.id);
            game.actionsRemaining = 0;
            nextTurn();
            broadcastGame();
        }, 100);
    }
  };

  const nextTurn = () => {
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer) processTowerAttacks(currentPlayer.id);

    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    game.actionsRemaining = 3;
    if (game.currentPlayerIndex === 0) game.turnNumber++;
    
    const nextPlayer = game.players[game.currentPlayerIndex];

    for (const entity of game.entities) {
        if (entity.ownerId === nextPlayer.id) {
            entity.actionsPerformedThisTurn = 0;
        }
    }
    
    if (nextPlayer.isBot) {
        triggerBotTurn();
    }
  };

  const hasResources = (player: Player, cost: any) => {
    return player.resources.ЗОЛОТО >= (cost.ЗОЛОТО || 0) && 
           player.resources.ДЕРЕВО >= (cost.ДЕРЕВО || 0) && 
           player.resources.МЯСО >= (cost.МЯСО || 0);
  };

  const spendResources = (player: Player, cost: any) => {
    player.resources.ЗОЛОТО -= (cost.ЗОЛОТО || 0);
    player.resources.ДЕРЕВО -= (cost.ДЕРЕВО || 0);
    player.resources.МЯСО -= (cost.МЯСО || 0);
  };

  const processAction = (action: GameAction, socket: any) => {
    
    if (action.type === 'LEAVE_GAME') {
        game.status = 'LOBBY';
        game.entities = [];
        game.turnNumber = 1;
        game.currentPlayerIndex = 0;
        game.actionsRemaining = 3;
        
        // Reset player readys & resources, but keep them in the lobby connected
        game.players.forEach(p => {
            p.ready = false;
            p.resources = { ...INITIAL_RESOURCES };
        });

        // Clear grid resources
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                 if (game.grid[y] && game.grid[y][x]) {
                     game.grid[y][x].resource = undefined;
                     game.grid[y][x].resourceAmount = 0;
                 }
            }
        }
        
        // Clear all visible cells to trigger strict resets on frontends
        game.visibleCells = [];
        broadcastGame();
        return;
    }

    const activePlayer = game.players[game.currentPlayerIndex];
    if (!activePlayer) return;

    if (game.actionsRemaining <= 0 && action.type !== 'END_TURN') return;

    const prevActions = game.actionsRemaining;

    switch (action.type) {
        case 'MOVE': {
            const entity = game.entities.find(e => e.id === action.entityId);
            if (!entity || entity.ownerId !== activePlayer.id) break;

            // BUILDINGS CANNOT MOVE
            if (['ЗАМОК', 'КАЗАРМА', 'СТЕНА', 'БАШНЯ', 'ВОРОТА'].includes(entity.type)) break;

            const dx = action.x - entity.x;
            const dy = action.y - entity.y;
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            const moveRange = UNIT_STATS[entity.race][entity.type].moveRange || 1;

            if (dist <= moveRange && dist > 0) {
                // If moving more than 1 cell (e.g. Hero jumping), we don't go through gates mechanics, 
                // we just check if the target cell is empty.
                if (dist > 1) {
                    const targetCell = game.grid[action.y]?.[action.x];
                    if (targetCell && !targetCell.resource) {
                        const entitiesInTargetCell = game.entities.filter(e => e.x === action.x && e.y === action.y && e.id !== entity.id);
                        if (entitiesInTargetCell.length === 0) {
                            entity.x = action.x;
                            entity.y = action.y;
                            entity.lastActionType = 'MOVE';
                            game.actionsRemaining -= 1;
                        }
                    }
                } else if (dist === 1) {
                    const targetCell = game.grid[action.y]?.[action.x];
                    if (!targetCell) break;

                    const entitiesInTargetCell = game.entities.filter(e => e.x === action.x && e.y === action.y && e.id !== entity.id);
                    // Check if target has a friendly gate
                    const friendlyGate = entitiesInTargetCell.find(e => e.type === 'ВОРОТА' && e.ownerId === activePlayer.id);

                    if (friendlyGate) {
                        // Try to jump OVER the gate (costs 2 actions total)
                        if (game.actionsRemaining < 2) break; // Need enough actions
                        const jumpX = action.x + dx;
                        const jumpY = action.y + dy;
                        if (jumpX >= 0 && jumpX < MAP_SIZE && jumpY >= 0 && jumpY < MAP_SIZE) {
                            const jumpCell = game.grid[jumpY][jumpX];
                            const entitiesInJumpCell = game.entities.filter(e => e.x === jumpX && e.y === jumpY);
                            if (!jumpCell.resource && entitiesInJumpCell.length === 0) {
                                // Successfully passed through gate to the empty cell behind it
                                entity.x = jumpX;
                                entity.y = jumpY;
                                entity.lastActionType = 'MOVE';
                                game.actionsRemaining -= 2;
                            }
                        }
                    } else {
                        // Normal move (no friendly gate, so target cell must be completely empty of obstacles)
                        let canPass = !targetCell.resource;
                        if (canPass && entitiesInTargetCell.length > 0) canPass = false;

                        if (canPass) {
                            entity.x = action.x;
                            entity.y = action.y;
                            entity.lastActionType = 'MOVE';
                            game.actionsRemaining -= 1;
                        }
                    }
                }
            } else if (dist === 2 && dx % 2 === 0 && dy % 2 === 0 && moveRange === 1) {
                // Gate jumping mechanic for standard units
                const midX = entity.x + dx / 2;
                const midY = entity.y + dy / 2;
                const entitiesInMidCell = game.entities.filter(e => e.x === midX && e.y === midY);
                const friendlyGate = entitiesInMidCell.find(e => e.type === 'ВОРОТА' && e.ownerId === activePlayer.id);

                if (friendlyGate) {
                    if (game.actionsRemaining < 2) break;
                    const jumpCell = game.grid[action.y]?.[action.x];
                    if (jumpCell && !jumpCell.resource) {
                        const entitiesInJumpCell = game.entities.filter(e => e.x === action.x && e.y === action.y && e.id !== entity.id);
                        if (entitiesInJumpCell.length === 0) {
                            entity.x = action.x;
                            entity.y = action.y;
                            entity.lastActionType = 'MOVE';
                            game.actionsRemaining -= 2;
                        }
                    }
                }
            }
            break;
        }
        case 'ATTACK': {
            const attacker = game.entities.find(e => e.id === action.attackerId);
            const target = game.entities.find(e => e.id === action.targetId);
            if (!attacker || !target || attacker.ownerId !== activePlayer.id) break;

            // Cannot attack friendlies
            if (attacker.ownerId === target.ownerId) break;

            const dist = Math.max(Math.abs(attacker.x - target.x), Math.abs(attacker.y - target.y));
            const attackerStats = UNIT_STATS[attacker.race][attacker.type];

            if (attacker.type === 'БАШНЯ') {
                // Setting target for tower
                if (dist <= (attackerStats.range || 5)) {
                    attacker.targetEntityId = target.id;
                    game.actionsRemaining--;
                }
                break;
            }

            if (dist <= (attackerStats.range || 1)) {
                let damage = attackerStats.attack || 5;
                
                // Iron rule: Archer attack becomes half at distance 1 (melee)
                if (attacker.type === 'ЛУЧНИК' && dist === 1) {
                    damage = Math.floor(damage / 2);
                }

                target.hp -= damage;
                attacker.lastActionType = 'ATTACK';
                attacker.lastActionTime = Date.now();

                if (target.hp <= 0) {
                    game.entities = game.entities.filter(e => e.id !== target.id);
                    if (target.type === 'ЗАМОК') {
                        game.status = 'FINISHED';
                    }
                }
                game.actionsRemaining--;
            }
            break;
        }
        case 'TRAIN': {
            const bldg = game.entities.find(e => e.id === action.buildingId);
            if (!bldg || bldg.ownerId !== activePlayer.id) break;
            if (bldg.underConstruction) break; // Cannot train during construction
            if (bldg.trainingTurnsLeft && bldg.trainingTurnsLeft > 0) break; // Cannot train multiple

            // Training rules
            if (bldg.type === 'ЗАМОК' && action.unitType !== 'РАБОЧИЙ') break;
            if (bldg.type === 'КАЗАРМА' && !['ВОИН', 'ЛУЧНИК', 'ОСАДНОЕ'].includes(action.unitType)) break;
            if (bldg.type === 'АЛТАРЬ' && action.unitType !== 'ГЕРОЙ') break;
            if (bldg.type !== 'ЗАМОК' && bldg.type !== 'КАЗАРМА' && bldg.type !== 'АЛТАРЬ') break;

            if (action.unitType === 'ГЕРОЙ' && game.entities.some(e => e.ownerId === activePlayer.id && (e.type === 'ГЕРОЙ' || e.trainingUnitType === 'ГЕРОЙ'))) {
                break; // Max 1 hero
            }

            const cost = UNIT_STATS[bldg.race][action.unitType].cost;
            if (hasResources(activePlayer, cost)) {
                spendResources(activePlayer, cost);
                bldg.trainingUnitType = action.unitType;
                bldg.trainingTurnsLeft = action.unitType === 'ГЕРОЙ' ? 3 : 2;
                bldg.justStartedTimer = true;
                game.actionsRemaining--;
            }
            break;
        }
        case 'HARVEST': {
            const worker = game.entities.find(e => e.id === action.workerId);
            if (!worker || worker.ownerId !== activePlayer.id || worker.type !== 'РАБОЧИЙ') break;
            const cell = game.grid[action.y]?.[action.x];
            if (cell && cell.resource && Math.abs(worker.x - cell.x) <= 1 && Math.abs(worker.y - cell.y) <= 1) {
                const amount = Math.min(cell.resourceAmount || 0, 50);
                activePlayer.resources[cell.resource] += amount;
                cell.resourceAmount! -= amount;
                if (cell.resourceAmount! <= 0) {
                    cell.resource = null!;
                    cell.resourceAmount = 0;
                }
                worker.lastActionType = 'HARVEST';
                worker.lastHarvestResource = cell.resource;
                worker.lastActionTime = Date.now();
                game.actionsRemaining--;
            }
            break;
        }
        case 'BUILD': {
            const worker = game.entities.find(e => e.id === action.workerId);
            if (!worker || worker.ownerId !== activePlayer.id || worker.type !== 'РАБОЧИЙ') break;
            
            // Check building limits
            const playerEntities = game.entities.filter(e => e.ownerId === activePlayer.id);
            if (action.buildingType === 'БАШНЯ') {
                const towerCount = playerEntities.filter(e => e.type === 'БАШНЯ').length;
                if (towerCount >= 4) {
                    socket.emit('error', 'Превышен лимит башен (макс. 4)!');
                    break;
                }
            }
            if (action.buildingType === 'ВОРОТА') {
                const gateCount = playerEntities.filter(e => e.type === 'ВОРОТА').length;
                if (gateCount >= 2) {
                    socket.emit('error', 'Превышен лимит врат (макс. 2)!');
                    break;
                }
            }
            if (action.buildingType === 'СТЕНА') {
                const wallCount = playerEntities.filter(e => e.type === 'СТЕНА').length;
                if (wallCount >= 20) {
                    socket.emit('error', 'Превышен лимит стен (макс. 20)!');
                    break;
                }
            }

            const cost = UNIT_STATS[worker.race][action.buildingType].cost;
            if (hasResources(activePlayer, cost)) {
                const dist = Math.max(Math.abs(worker.x - action.x), Math.abs(worker.y - action.y));
                const targetCell = game.grid[action.y]?.[action.x];
                
                // Ensure cell is empty of entities, resources AND is within reach
                if (!game.entities.some(e => e.x === action.x && e.y === action.y) && 
                    targetCell && !targetCell.resource && dist <= 1) {
                    spendResources(activePlayer, cost);
                    worker.lastActionType = 'BUILD';
                    worker.lastActionTime = Date.now();
                    game.entities.push({
                        id: nanoid(),
                        type: action.buildingType,
                        race: worker.race,
                        ownerId: activePlayer.id,
                        x: action.x,
                        y: action.y,
                        hp: UNIT_STATS[worker.race][action.buildingType].hp,
                        maxHp: UNIT_STATS[worker.race][action.buildingType].hp,
                        actionsPerformedThisTurn: 0,
                        underConstruction: true,
                        constructionTurnsLeft: 2,
                        justStartedTimer: true
                    });
                    game.actionsRemaining--;
                }
            }
            break;
        }
        case 'ROTATE': {
            const ent = game.entities.find(e => e.id === action.entityId);
            if (!ent || ent.ownerId !== activePlayer.id) break;
            if (ent.type !== 'СТЕНА' && ent.type !== 'ВОРОТА') break;
            ent.rotation = action.rotation;
            break;
        }
        case 'END_TURN': {
            // User requested that "End Turn" button should end ONE ACTION (one "ходок"), 
            // not pass the whole turn immediately if they just want to skip a step.
            game.actionsRemaining--;
            break;
        }
    }

    if (game.actionsRemaining < prevActions) {
        const spentActions = prevActions - game.actionsRemaining;
        for (let i = 0; i < spentActions; i++) {
            tickPlayerTimers(activePlayer.id);
        }
    }

    if (game.actionsRemaining <= 0 && game.status !== 'FINISHED') nextTurn();
    broadcastGame();
  };

  io.on('connection', (socket) => {
    const sessionId = (socket.handshake.query.sessionId as string) || socket.id;

    socket.emit('game:init', { playerId: sessionId, game });

    socket.on('player:join', (name: string) => {
        const existing = game.players.find(p => p.id === sessionId);
        if (!existing && game.players.length < 3 && game.status === 'LOBBY') {
            game.players.push({
                id: sessionId,
                name: name || `Игрок ${game.players.length + 1}`,
                race: 'ЛЮДИ',
                ready: false,
                color: PLAYER_COLORS[game.players.length % PLAYER_COLORS.length],
                resources: { ...INITIAL_RESOURCES }
            });
        }
        socket.emit('game:init', { playerId: sessionId, game });
        broadcastGame();
    });

    socket.on('player:add_bot', () => {
        if (game.status !== 'LOBBY' || game.players.length >= 3) return;
        
        // Ensure the human sender is in the game first so they remain host
        const existing = game.players.find(p => p.id === sessionId);
        if (!existing) {
            game.players.push({
                id: sessionId,
                name: `Игрок ${game.players.length + 1}`,
                race: 'ЛЮДИ',
                ready: false,
                color: PLAYER_COLORS[game.players.length % PLAYER_COLORS.length],
                resources: { ...INITIAL_RESOURCES }
            });
        }

        const botId = `bot-${nanoid(5)}`;
        const races: Race[] = ['ЛЮДИ', 'ОРКИ', 'НЕЖИТЬ', 'КРОВАВЫЕ ЭЛЬФЫ'];
        game.players.push({
            id: botId,
            name: `Бот ${game.players.length + 1}`,
            race: races[Math.floor(Math.random() * races.length)],
            ready: true,
            color: PLAYER_COLORS[game.players.length % PLAYER_COLORS.length],
            resources: { ...INITIAL_RESOURCES },
            isBot: true
        });
        checkStart();
        broadcastGame();
    });

    socket.on('player:update', (data: { race: Race, name: string }) => {
        if (game.status !== 'LOBBY') return;
        const player = game.players.find(p => p.id === sessionId);
        if (player) {
            player.race = data.race;
            player.name = data.name;
        } else {
            game.players.push({
                id: sessionId,
                name: data.name || `Игрок ${game.players.length + 1}`,
                race: data.race,
                ready: false,
                color: PLAYER_COLORS[game.players.length % PLAYER_COLORS.length],
                resources: { ...INITIAL_RESOURCES }
            });
        }
        broadcastGame();
    });

    socket.on('player:ready', (data: { race: Race, name: string, ready: boolean }) => {
        if (game.status !== 'LOBBY') return;
        const player = game.players.find(p => p.id === sessionId);
        if (player) {
            player.race = data.race;
            player.ready = data.ready;
            player.name = data.name;
        } else {
            game.players.push({
                id: sessionId,
                name: data.name || `Игрок ${game.players.length + 1}`,
                race: data.race,
                ready: data.ready,
                color: PLAYER_COLORS[game.players.length % PLAYER_COLORS.length],
                resources: { ...INITIAL_RESOURCES }
            });
        }
        checkStart();
        broadcastGame();
    });

    socket.on('lobby:reset', () => {
        if (game.status !== 'LOBBY') return;
        const host = game.players.find(p => !p.isBot);
        if (host && host.id === sessionId) {
            game.players = [host]; // Keep only the human host, remove all bots and other players
            host.ready = false;
            broadcastGame();
        }
    });

    socket.on('game:start', () => {
        if (game.status !== 'LOBBY') return;
        const host = game.players.find(p => !p.isBot);
        if (host && host.id === sessionId) {
            if (game.players.every(p => p.ready)) {
                startGame();
            } else {
                socket.emit('error', 'Все игроки должны быть готовы!');
            }
        }
    });

    socket.on('game:action', (action: GameAction) => {
        if (action.type === 'LEAVE_GAME') {
            processAction(action, socket);
            return;
        }

        if (game.status !== 'PLAYING') return;
        
        // Ensure only active player can issue commands (except leaving game)
        const activePlayer = game.players[game.currentPlayerIndex];
        if (!activePlayer || activePlayer.id !== sessionId) return;

        processAction(action, socket);
    });

    socket.on('disconnect', () => {
        // Cleanup if necessary
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'index.html')));
  }

  httpServer.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
}

start();
