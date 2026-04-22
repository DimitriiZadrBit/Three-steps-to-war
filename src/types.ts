
export type Race = 'КРОВАВЫЕ ЭЛЬФЫ' | 'ОРКИ' | 'НЕЖИТЬ' | 'ЛЮДИ';
export type ResourceType = 'ЗОЛОТО' | 'ДЕРЕВО' | 'МЯСО';

export interface Resources {
  ЗОЛОТО: number;
  ДЕРЕВО: number;
  МЯСО: number;
}

export type EntityType = 'РАБОЧИЙ' | 'ВОИН' | 'ЛУЧНИК' | 'ОСАДНОЕ' | 'СТЕНА' | 'БАШНЯ' | 'ЗАМОК' | 'КАЗАРМА' | 'ВОРОТА' | 'АЛТАРЬ' | 'ГЕРОЙ';

export interface Entity {
  id: string;
  type: EntityType;
  race: Race;
  ownerId: string; // socket.id or player index string
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  actionsPerformedThisTurn: number;
  underConstruction?: boolean;
  constructionTurnsLeft?: number;
  trainingUnitType?: EntityType;
  trainingTurnsLeft?: number;
  justStartedTimer?: boolean;
  rotation?: number;
  lastActionType?: string;
  lastActionTime?: number;
  lastHarvestResource?: ResourceType;
  targetEntityId?: string; // For automated tower attacks
}

export interface Cell {
  x: number;
  y: number;
  resource?: ResourceType;
  resourceAmount?: number;
}

export interface Player {
  id: string; // socket.id or bot-id
  name: string;
  race: Race;
  ready: boolean;
  color: string;
  resources: Resources;
  isBot?: boolean;
}

export interface GameState {
  id: string;
  grid: Cell[][];
  entities: Entity[];
  players: Player[];
  currentPlayerIndex: number;
  actionsRemaining: number;
  turnNumber: number;
  status: 'LOBBY' | 'PLAYING' | 'FINISHED';
  visibleCells: string[]; 
}

export interface ServerToClientEvents {
  'game:update': (game: GameState) => void;
  'game:init': (data: { playerId: string, game: GameState }) => void;
  'error': (msg: string) => void;
}

export interface ClientToServerEvents {
  'player:join': (name: string) => void;
  'player:ready': (data: { race: Race, name: string, ready: boolean }) => void;
  'player:update': (data: { race: Race, name: string }) => void;
  'player:add_bot': () => void;
  'lobby:reset': () => void;
  'game:start': () => void;
  'game:action': (action: GameAction) => void;
}

export type GameAction = 
  | { type: 'MOVE', entityId: string, x: number, y: number }
  | { type: 'ATTACK', attackerId: string, targetId: string }
  | { type: 'BUILD', workerId: string, buildingType: EntityType, x: number, y: number }
  | { type: 'TRAIN', buildingId: string, unitType: EntityType }
  | { type: 'HARVEST', workerId: string, x: number, y: number }
  | { type: 'ROTATE', entityId: string, rotation: number }
  | { type: 'END_TURN' }
  | { type: 'LEAVE_GAME' };
