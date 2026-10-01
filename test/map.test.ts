import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ENCOUNTERS, encounterById, encountersOf, scaleEncounter } from '../src/content/encounters.ts';
import { STANDARD_LIBRARY, EFFECT_BY_ID } from '../src/content/index.ts';
import { rarityProfile } from '../src/core/rarity.ts';
import {
  DEFAULT_MAP_RULES,
  availableMoves,
  depthStep,
  generateMap,
  nodeAt,
  tierForRow,
  validateMap,
} from '../src/game/map.ts';

const library = STANDARD_LIBRARY;

describe('the bestiary', () => {
  it('has several encounters at every tier, plus elites and bosses', () => {
    for (const tier of [1, 2, 3] as const) {
      assert.ok(
        encountersOf('battle', tier).length >= 4,
        `tier ${tier} needs enough battles for a map to vary`,
      );
    }
    assert.ok(encountersOf('elite').length >= 3);
    assert.ok(encountersOf('boss').length >= 2, 'more than one boss, or every run ends the same');
  });

  it('only references cards and effects that exist', () => {
    for (const item of ENCOUNTERS) {
      for (const creature of item.creatures) {
        const definition = library.tryGetCard(creature.definitionId);
        assert.ok(definition, `${item.id} fields unknown creature "${creature.definitionId}"`);
        assert.ok(
          creature.level >= 1 && creature.level <= rarityProfile(definition.rarity).maxLevel,
          `${item.id}: ${creature.definitionId} at level ${creature.level} exceeds its cap`,
        );
      }
      for (const effectId of item.effects) {
        assert.ok(EFFECT_BY_ID.has(effectId), `${item.id} holds unknown effect "${effectId}"`);
      }
      assert.ok(library.tryGetCard(item.art), `${item.id} has no portrait art`);
    }
  });

  it('fields a deck big enough to play a duel', () => {
    for (const item of ENCOUNTERS) {
      assert.ok(item.creatures.length >= 8, `${item.id} has too few creatures`);
      assert.ok(item.nexusHealth > 0);
    }
  });

  it('scales nexus health and levels up through the tiers', () => {
    const average = (tier: 1 | 2 | 3) => {
      const pool = encountersOf('battle', tier);
      return pool.reduce((sum, item) => sum + item.nexusHealth, 0) / pool.length;
    };
    assert.ok(average(2) > average(1));
    assert.ok(average(3) > average(2));
  });

  it('looks an encounter up by id and refuses an unknown one', () => {
    assert.equal(encounterById('hollow-crown').kind, 'boss');
    assert.throws(() => encounterById('nope'), /Unknown encounter/);
  });
});

describe('map generation', () => {
  it('builds a connected map with no dead ends, over many seeds', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const map = generateMap(seed);
      const problems = validateMap(map);
      assert.deepEqual(problems, [], `seed ${seed}: ${problems.join('; ')}`);
    }
  });

  it('is deterministic for a seed', () => {
    const a = generateMap(42);
    const b = generateMap(42);
    assert.deepEqual([...a.nodes.keys()].sort(), [...b.nodes.keys()].sort());
    for (const [id, node] of a.nodes) {
      assert.deepEqual(node, b.nodes.get(id), `node ${id} differs`);
    }
  });

  it('produces different maps for different seeds', () => {
    const shape = (seed: number) =>
      [...generateMap(seed).nodes.values()]
        .map((node) => `${node.id}${node.kind}${node.encounterId ?? ''}`)
        .sort()
        .join('|');
    assert.notEqual(shape(1), shape(2));
  });

  it('offers a real choice: several entries, and branches on the way up', () => {
    let branching = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const map = generateMap(seed);
      assert.ok((map.byRow[0] ?? []).length >= 2, `seed ${seed} has only one way in`);
      branching += [...map.nodes.values()].filter((node) => node.exits.length > 1).length;
    }
    assert.ok(branching > 60, 'a map with no forks is a corridor, not a map');
  });

  it('ends every route at the one boss', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const map = generateMap(seed);
      const top = map.byRow[map.rows - 1] ?? [];
      assert.deepEqual(top, [map.bossId]);
      assert.equal(nodeAt(map, map.bossId).kind, 'boss');

      for (const id of map.byRow[map.rows - 2] ?? []) {
        assert.deepEqual(nodeAt(map, id).exits, [map.bossId]);
      }
    }
  });

  it('keeps the opening rows free of elites', () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const map = generateMap(seed);
      for (const id of map.byRow[0] ?? []) {
        assert.equal(nodeAt(map, id).kind, 'battle', `seed ${seed}: row 0 should be plain battles`);
      }
      for (const id of map.byRow[1] ?? []) {
        assert.notEqual(nodeAt(map, id).kind, 'elite', `seed ${seed}: row 1 elite is too early`);
      }
    }
  });

  it('puts a mix of node kinds on a map', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const node of generateMap(seed).nodes.values()) kinds.add(node.kind);
    }
    for (const kind of ['battle', 'elite', 'rest', 'cache', 'boss']) {
      assert.ok(kinds.has(kind), `no ${kind} node appeared across thirty maps`);
    }
  });

  it('gives every fighting node a real encounter of the right kind', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      for (const node of generateMap(seed).nodes.values()) {
        if (node.kind === 'rest' || node.kind === 'cache') {
          assert.equal(node.encounterId, null);
          continue;
        }
        assert.ok(node.encounterId, `${node.id} fights nothing`);
        const found = encounterById(node.encounterId);
        if (node.kind === 'boss') assert.equal(found.kind, 'boss');
        else assert.equal(found.kind, node.kind);
      }
    }
  });

  it('escalates encounter tier with depth', () => {
    assert.equal(tierForRow(0, 12), 1);
    assert.equal(tierForRow(5, 12), 2);
    assert.equal(tierForRow(9, 12), 3);
  });

  it('only ever moves one row upward', () => {
    const map = generateMap(7);
    const entries = availableMoves(map, null);
    assert.deepEqual(entries, map.byRow[0]);

    for (const node of map.nodes.values()) {
      for (const exit of availableMoves(map, node.id)) {
        assert.equal(nodeAt(map, exit).row, node.row + 1);
      }
    }
    assert.deepEqual(availableMoves(map, map.bossId), []);
  });

  it('can always be walked from an entry to the boss', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const map = generateMap(seed);
      let current = (map.byRow[0] ?? [])[0] as string;
      const visited: string[] = [current];

      for (let step = 0; step < map.rows + 2; step += 1) {
        const moves = availableMoves(map, current);
        if (moves.length === 0) break;
        current = moves[0] as string;
        visited.push(current);
      }
      assert.equal(current, map.bossId, `seed ${seed} never reached the boss`);
      assert.equal(visited.length, map.rows, `seed ${seed} walked ${visited.length} rows`);
    }
  });

  it('respects a narrower ruleset', () => {
    const map = generateMap(3, { ...DEFAULT_MAP_RULES, rows: 6, columns: 3, routes: 3 });
    assert.equal(map.rows, 6);
    assert.deepEqual(validateMap(map), []);
    assert.ok(map.nodes.size <= 6 * 3);
  });
});

describe('firming an encounter up by depth', () => {
  const capOf = (definitionId: string): number =>
    rarityProfile(library.getCard(definitionId).rarity).maxLevel;

  it('counts rows from the first row of the row\'s own tier', () => {
    // Tier 1 covers rows 0-3, tier 2 rows 4-6, tier 3 rows 7-11.
    assert.deepEqual([0, 1, 2, 3].map((row) => depthStep(row, 12)), [0, 1, 2, 3]);
    assert.deepEqual([4, 5, 6].map((row) => depthStep(row, 12)), [0, 1, 2]);
    assert.deepEqual([7, 8, 9, 10, 11].map((row) => depthStep(row, 12)), [0, 1, 2, 3, 4]);
  });

  it('leaves the first row of a tier exactly as it was written', () => {
    const base = encounterById('scavenger-warren');
    assert.equal(scaleEncounter(base, 0, capOf), base);
  });

  it('adds a level and three nexus health per step', () => {
    const base = encounterById('scavenger-warren');
    const firmer = scaleEncounter(base, 2, capOf);
    assert.equal(firmer.nexusHealth, base.nexusHealth + 6);
    for (const [index, creature] of firmer.creatures.entries()) {
      assert.equal(creature.level, (base.creatures[index] as { level: number }).level + 2);
    }
  });

  it('never pushes a card past the level cap of its rarity', () => {
    for (const item of ENCOUNTERS) {
      const firmer = scaleEncounter(item, 4, capOf);
      for (const creature of firmer.creatures) {
        assert.ok(
          creature.level <= capOf(creature.definitionId),
          `${item.id}: ${creature.definitionId} scaled past its cap`,
        );
      }
    }
  });

  it('keeps everything else about the encounter intact', () => {
    const base = encounterById('hollow-crown');
    const firmer = scaleEncounter(base, 3, capOf);
    assert.equal(firmer.id, base.id);
    assert.equal(firmer.name, base.name);
    assert.equal(firmer.profile, base.profile);
    assert.deepEqual(firmer.effects, base.effects);
  });
});
