
import { Race, GameState, Cell, ResourceType, Player } from '../types';
import { MAP_SIZE, INITIAL_RESOURCES, PLAYER_COLORS } from '../constants';
import { nanoid } from 'nanoid';

export function generateInitialState(playerRaces: Race[]): GameState {
  const grid: Cell[][] = [];
  for (let y = 0; y < MAP_SIZE; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < MAP_SIZE; x++) {
      row.push({ x, y });
    }
    grid.push(row);
  }

  // Add random resources
  const resources: ResourceType[] = ['ЗОЛОТО', 'ДЕРЕВО', 'МЯСО'];
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(Math.random() * MAP_SIZE);
    const y = Math.floor(Math.random() * MAP_SIZE);
    grid[y][x].resource = resources[Math.floor(Math.random() * 3)];
    grid[y][x].resourceAmount = 1000;
  }

  const players: Player[] = playerRaces.map((race, i) => ({
    id: `player-${i}`,
    name: `Игрок ${i + 1}`,
    race,
    ready: true,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    resources: { ...INITIAL_RESOURCES }
  }));

  return {
    id: nanoid(),
    grid,
    entities: [],
    players,
    currentPlayerIndex: 0,
    actionsRemaining: 3,
    turnNumber: 1,
    status: 'PLAYING',
    visibleCells: []
  };
}
