/**
 * The overworld map.
 *
 * A directed graph of rows climbing toward a boss. Several routes start at the
 * bottom and wander upward, and the union of those walks is the map — so every
 * node is on at least one complete path and the player can never strand
 * themselves. Which route you take decides which encounters you meet, which is
 * the point: the map is the run's first real decision, made before any card is
 * played.
 *
 * Generation follows the shape Slay the Spire uses: walk `routes` paths from
 * the bottom row to the top, stepping one column left, right or straight at
 * each row, then keep only what those walks touched.
 */

import type { Encounter, EncounterTier } from '../content/encounters.ts';
import { encountersOf } from '../content/encounters.ts';
import type { Rng } from '../core/rng.ts';
import { createRng } from '../core/rng.ts';

export const NODE_KINDS = ['battle', 'elite', 'rest', 'cache', 'boss'] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface MapNode {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly kind: NodeKind;
  /** Encounter id for fighting nodes; null for rest and cache. */
  readonly encounterId: string | null;
  /** Node ids on the row above that this one leads to. */
  readonly exits: readonly string[];
}

export interface GameMap {
  readonly rows: number;
  readonly columns: number;
  readonly nodes: ReadonlyMap<string, MapNode>;
  /** Node ids per row, left to right. */
  readonly byRow: readonly (readonly string[])[];
  readonly bossId: string;
}

export interface MapRules {
  readonly rows: number;
  readonly columns: number;
  /** Independent walks from bottom to top. More routes, wider map. */
  readonly routes: number;
  /** Rows that are never anything but an ordinary battle. */
  readonly safeRows: number;
  readonly restChance: number;
  readonly cacheChance: number;
  readonly eliteChance: number;
}

export const DEFAULT_MAP_RULES: MapRules = {
  rows: 12,
  columns: 6,
  routes: 6,
  safeRows: 1,
  restChance: 0.16,
  cacheChance: 0.14,
  eliteChance: 0.18,
};

const nodeId = (row: number, column: number): string => `${row}:${column}`;

/** Walks one route from the bottom row to the row below the boss. */
function walk(rng: Rng, rules: MapRules, edges: Map<string, Set<string>>): void {
  let column = rng.int(rules.columns);
  for (let row = 0; row < rules.rows - 2; row += 1) {
    const step = rng.int(3) - 1;
    const next = Math.max(0, Math.min(rules.columns - 1, column + step));
    const from = nodeId(row, column);
    if (!edges.has(from)) edges.set(from, new Set());
    (edges.get(from) as Set<string>).add(nodeId(row + 1, next));
    column = next;
  }
  // The last ordinary row always funnels into the boss.
  const from = nodeId(rules.rows - 2, column);
  if (!edges.has(from)) edges.set(from, new Set());
  (edges.get(from) as Set<string>).add(nodeId(rules.rows - 1, 0));
}

/** Which tier of encounter belongs at this depth. */
export function tierForRow(row: number, rows: number): EncounterTier {
  const share = row / Math.max(1, rows - 2);
  if (share < 0.34) return 1;
  if (share < 0.7) return 2;
  return 3;
}

/**
 * How many rows above the first row of its own tier this row sits — the step a
 * placed encounter is firmed up by, so difficulty climbs inside a tier instead
 * of flattening out until the next one.
 */
export function depthStep(row: number, rows: number): number {
  const tier = tierForRow(row, rows);
  let first = row;
  while (first > 0 && tierForRow(first - 1, rows) === tier) first -= 1;
  return row - first;
}

function pickKind(rng: Rng, rules: MapRules, row: number): NodeKind {
  if (row === rules.rows - 1) return 'boss';
  if (row < rules.safeRows) return 'battle';

  // A rest immediately before the boss is a gift nobody should be denied.
  if (row === rules.rows - 2) return rng.chance(0.55) ? 'rest' : 'battle';

  const roll = rng.next();
  if (roll < rules.restChance) return 'rest';
  if (roll < rules.restChance + rules.cacheChance) return 'cache';
  if (row >= 2 && roll < rules.restChance + rules.cacheChance + rules.eliteChance) return 'elite';
  return 'battle';
}

function pickEncounter(rng: Rng, kind: NodeKind, row: number, rows: number): string | null {
  if (kind === 'rest' || kind === 'cache') return null;

  if (kind === 'boss') {
    const bosses = encountersOf('boss');
    return (rng.pick(bosses) as Encounter).id;
  }

  const tier = tierForRow(row, rows);
  const exact = encountersOf(kind, tier);
  // Elites are thin at some tiers; fall back to any elite rather than crash.
  const pool = exact.length > 0 ? exact : encountersOf(kind);
  return (rng.pick(pool) as Encounter).id;
}

export function generateMap(seed: number, rules: MapRules = DEFAULT_MAP_RULES): GameMap {
  const rng = createRng(seed);
  const edges = new Map<string, Set<string>>();

  for (let i = 0; i < rules.routes; i += 1) walk(rng, rules, edges);

  // Everything the walks touched, as a node set.
  const touched = new Set<string>();
  for (const [from, tos] of edges) {
    touched.add(from);
    for (const to of tos) touched.add(to);
  }

  const nodes = new Map<string, MapNode>();
  const byRow: string[][] = Array.from({ length: rules.rows }, () => []);

  for (let row = 0; row < rules.rows; row += 1) {
    for (let column = 0; column < rules.columns; column += 1) {
      const id = nodeId(row, column);
      if (!touched.has(id)) continue;

      const kind = pickKind(rng, rules, row);
      nodes.set(id, {
        id,
        row,
        column,
        kind,
        encounterId: pickEncounter(rng, kind, row, rules.rows),
        exits: [...(edges.get(id) ?? [])].sort(),
      });
      byRow[row]?.push(id);
    }
  }

  return {
    rows: rules.rows,
    columns: rules.columns,
    nodes,
    byRow,
    bossId: nodeId(rules.rows - 1, 0),
  };
}

/** Nodes the player may move to from `nodeId`, or the entry row at the start. */
export function availableMoves(map: GameMap, from: string | null): readonly string[] {
  if (from === null) return map.byRow[0] ?? [];
  return map.nodes.get(from)?.exits ?? [];
}

export function nodeAt(map: GameMap, id: string): MapNode {
  const node = map.nodes.get(id);
  if (!node) throw new Error(`No map node "${id}".`);
  return node;
}

/**
 * Every node is reachable from the entry row and leads, eventually, to the
 * boss. A map that fails this would let a player walk into a dead end.
 */
export function validateMap(map: GameMap): readonly string[] {
  const problems: string[] = [];

  const reachable = new Set<string>(map.byRow[0] ?? []);
  for (let row = 0; row < map.rows; row += 1) {
    for (const id of map.byRow[row] ?? []) {
      if (!reachable.has(id)) continue;
      for (const exit of nodeAt(map, id).exits) reachable.add(exit);
    }
  }

  for (const id of map.nodes.keys()) {
    if (!reachable.has(id)) problems.push(`${id} cannot be reached from the start`);
  }
  for (const node of map.nodes.values()) {
    if (node.row < map.rows - 1 && node.exits.length === 0) {
      problems.push(`${node.id} is a dead end`);
    }
    for (const exit of node.exits) {
      if (!map.nodes.has(exit)) problems.push(`${node.id} leads to missing node ${exit}`);
      else if (nodeAt(map, exit).row !== node.row + 1) {
        problems.push(`${node.id} skips a row to ${exit}`);
      }
    }
  }
  if (!map.nodes.has(map.bossId)) problems.push('the boss node is missing');

  return problems;
}

/** Longest path length, used to pace XP against how far a route runs. */
export function routeLength(map: GameMap): number {
  return map.rows;
}
