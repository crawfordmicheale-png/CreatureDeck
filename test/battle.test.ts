import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ABILITY_HANDLERS } from '../src/battle/abilityHandlers.ts';
import { GREEDY_CONTROLLER, SWARM_CONTROLLER, createScriptedController } from '../src/battle/controllers.ts';
import { runBattle } from '../src/battle/engine.ts';
import type { BattlePlayerSetup } from '../src/battle/engine.ts';
import { DEFAULT_BATTLE_CONFIG } from '../src/battle/types.ts';
import type { BattleEvent, BattleResult } from '../src/battle/types.ts';
import { ABILITIES, STANDARD_LIBRARY } from '../src/content/index.ts';
import type { AbilitySlot, CardDefinition } from '../src/core/cardDefinition.ts';
import { defineCard } from '../src/core/cardDefinition.ts';
import { createCardInstance, resolveCard } from '../src/core/cardInstance.ts';
import type { CardInstance } from '../src/core/cardInstance.ts';
import { createLibrary } from '../src/core/library.ts';
import type { CardLibrary } from '../src/core/library.ts';
import type { StatBlock } from '../src/core/stats.ts';

// --------------------------------------------------------------- test fixture

interface TestCardSpec {
  readonly id: string;
  readonly stats: Partial<StatBlock>;
  readonly ability?: string;
}

/**
 * A miniature library. Real abilities (so weights and params are the shipped
 * ones) bolted onto synthetic stat lines we can reason about exactly.
 */
function fixtureLibrary(specs: readonly TestCardSpec[]): CardLibrary {
  const cards: CardDefinition[] = specs.map((spec) => {
    const abilities: AbilitySlot[] = spec.ability
      ? [{ abilityId: spec.ability, unlockLevel: 1 }]
      : [];
    return defineCard({
      id: spec.id,
      name: spec.id,
      rarity: 'common',
      family: 'beast',
      baseStats: spec.stats,
      abilities,
      flavor: '',
    });
  });
  return createLibrary(cards, ABILITIES);
}

function instances(library: CardLibrary, ids: readonly string[]): CardInstance[] {
  return ids.map((id, index) =>
    createCardInstance(library.getCard(id), { instanceId: `${id}-${index}` }),
  );
}

interface ArenaOptions {
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly library: CardLibrary;
  readonly seed?: number;
  readonly maxRounds?: number;
  readonly nexusHealth?: number;
}

/** Deploys both sides' whole deck in order, then lets them fight. */
function arena(options: ArenaOptions): BattleResult {
  const leftDeck = instances(options.library, options.left);
  const rightDeck = instances(options.library, options.right);
  const setups: readonly [BattlePlayerSetup, BattlePlayerSetup] = [
    {
      id: 'p1',
      name: 'Left',
      deck: leftDeck,
      controller: createScriptedController(leftDeck.map((card) => card.instanceId)),
    },
    {
      id: 'p2',
      name: 'Right',
      deck: rightDeck,
      controller: createScriptedController(rightDeck.map((card) => card.instanceId)),
    },
  ];
  return runBattle(setups, options.library, {
    seed: options.seed ?? 1,
    maxRounds: options.maxRounds ?? 25,
    nexusHealth: options.nexusHealth ?? 40,
  });
}

function eventsOfType(result: BattleResult, type: BattleEvent['type']): readonly BattleEvent[] {
  return result.log.filter((event) => event.type === type);
}

function abilityEvents(result: BattleResult, abilityId: string): readonly BattleEvent[] {
  return result.log.filter((event) => event.abilityId === abilityId);
}

// ------------------------------------------------------------------- the engine

describe('battle engine', () => {
  const library = STANDARD_LIBRARY;

  function standardSetup(seed: number) {
    const deckIds = [
      'ember-whelp',
      'thicket-hare',
      'tide-minnow',
      'pebble-grub',
      'dusk-mite',
      'gale-sprite',
      'scrapfang-pup',
      'ashfang-jackal',
      'cinder-imp',
      'reef-sentinel',
      'grave-moth',
      'bramble-warden',
    ];
    const left = deckIds.map((id, i) =>
      createCardInstance(library.getCard(id), { instanceId: `l-${id}-${i}` }),
    );
    const right = deckIds.map((id, i) =>
      createCardInstance(library.getCard(id), { instanceId: `r-${id}-${i}` }),
    );
    const setups: readonly [BattlePlayerSetup, BattlePlayerSetup] = [
      { id: 'p1', name: 'Left', deck: left, controller: GREEDY_CONTROLLER },
      { id: 'p2', name: 'Right', deck: right, controller: SWARM_CONTROLLER },
    ];
    return runBattle(setups, library, { seed });
  }

  it('replays identically from the same seed', () => {
    const a = standardSetup(12345);
    const b = standardSetup(12345);
    assert.equal(a.winner, b.winner);
    assert.equal(a.rounds, b.rounds);
    assert.deepEqual(a.log, b.log);
  });

  it('produces a different battle from a different seed', () => {
    const a = standardSetup(1);
    const b = standardSetup(2);
    assert.notDeepEqual(a.log, b.log);
  });

  it('always terminates and reports a coherent result', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = standardSetup(seed);
      assert.ok(result.rounds >= 1 && result.rounds <= 25, `seed ${seed} rounds ${result.rounds}`);
      assert.equal(result.players.length, 2);
      if (result.winner === null) {
        assert.equal(result.loser, null);
      } else {
        assert.notEqual(result.loser, result.winner);
        const loser = result.players.find((player) => player.playerId === result.loser);
        const winner = result.players.find((player) => player.playerId === result.winner);
        assert.ok(loser && winner);
        if (result.reason === 'nexus-destroyed') assert.equal(loser.nexusHealth, 0);
      }
    }
  });

  it('never lets a nexus go below zero', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const player of standardSetup(seed).players) {
        assert.ok(player.nexusHealth >= 0, `seed ${seed}: ${player.nexusHealth}`);
      }
    }
  });
});

describe('deployment rules', () => {
  const library = fixtureLibrary([
    { id: 'pebble', stats: { might: 3, vitality: 20, speed: 5 } },
    { id: 'boulder', stats: { might: 30, vitality: 90, speed: 5, guard: 10 } },
  ]);

  it('holds a creature back on the round it lands', () => {
    // Left deploys alone, so any attack must go straight at the enemy nexus.
    const result = arena({ left: ['pebble'], right: [], library });

    assert.equal(eventsOfType(result, 'deploy')[0]?.round, 1, 'it should land in round 1');

    const attacks = eventsOfType(result, 'attack');
    assert.ok(attacks.length > 0, 'the lone creature should eventually swing');
    assert.ok(
      attacks.every((event) => event.round >= 2),
      'a creature deployed in round 1 must not attack until round 2',
    );
  });

  it('will not deploy a card the player cannot pay for', () => {
    // `boulder` resolves to an Elite, which costs more than round-1 energy.
    const boulder = resolveCard(createCardInstance(library.getCard('boulder'), {}), library);
    assert.ok(boulder.deployCost > DEFAULT_BATTLE_CONFIG.startingEnergy, 'fixture sanity');

    const result = arena({ left: ['boulder'], right: [], library, maxRounds: 1 });
    assert.equal(eventsOfType(result, 'deploy').length, 0, 'nothing affordable in round 1');
  });

  it('respects the board slot limit', () => {
    const many = Array.from({ length: 8 }, () => 'pebble');
    const deck = instances(library, many);
    const result = runBattle(
      [
        {
          id: 'p1',
          name: 'Left',
          deck,
          controller: createScriptedController(deck.map((card) => card.instanceId)),
        },
        { id: 'p2', name: 'Right', deck: instances(library, ['pebble']), controller: GREEDY_CONTROLLER },
      ],
      library,
      { seed: 3, boardSlots: 3, maxRounds: 6 },
    );

    const perRound = new Map<number, number>();
    for (const event of eventsOfType(result, 'deploy')) {
      if (event.playerId !== 'p1') continue;
      perRound.set(event.round, (perRound.get(event.round) ?? 0) + 1);
    }
    const total = [...perRound.values()].reduce((sum, count) => sum + count, 0);
    assert.ok(total <= 6, `three slots cannot hold ${total} simultaneous deploys`);
  });

  it('charges each player escalating fatigue once their deck runs out', () => {
    const result = arena({ left: ['pebble'], right: ['pebble'], library, maxRounds: 12 });
    const fatigue = eventsOfType(result, 'fatigue');
    assert.ok(fatigue.length > 0, 'a one-card deck should run dry');

    for (const playerId of ['p1', 'p2']) {
      const amounts = fatigue
        .filter((event) => event.playerId === playerId)
        .map((event) => event.amount ?? 0);
      assert.ok(amounts.length > 0, `${playerId} should have gone to fatigue`);
      assert.deepEqual(
        amounts,
        amounts.map((_, i) => i + 1),
        `${playerId} fatigue should climb 1, 2, 3, ...`,
      );
    }
  });
});

// ------------------------------------------------------------------ abilities

describe('ability coverage', () => {
  it('gives every printed ability a battle handler', () => {
    for (const ability of ABILITIES) {
      assert.ok(ABILITY_HANDLERS[ability.id], `no handler for "${ability.id}"`);
    }
  });

  it('has no handler without a printed ability', () => {
    const printed = new Set(ABILITIES.map((ability) => ability.id));
    for (const id of Object.keys(ABILITY_HANDLERS)) {
      assert.ok(printed.has(id), `handler "${id}" has no printed ability`);
    }
  });

  it('prices every ability with a positive weight and documented params', () => {
    for (const ability of ABILITIES) {
      assert.ok(ability.weight > 0, `${ability.id} must carry weight`);
      for (const match of ability.description.matchAll(/\{(\w+)\}/g)) {
        const key = match[1] as string;
        assert.ok(
          key in ability.params,
          `${ability.id} description references {${key}} with no such param`,
        );
      }
    }
  });
});

describe('ability behaviour', () => {
  it('rebirth brings a creature back exactly once', () => {
    const library = fixtureLibrary([
      { id: 'phoenix', stats: { might: 1, vitality: 20, speed: 1 }, ability: 'rebirth' },
      { id: 'executioner', stats: { might: 40, vitality: 90, speed: 9 } },
    ]);
    const result = arena({ left: ['phoenix'], right: ['executioner'], library, maxRounds: 12 });
    const revivals = abilityEvents(result, 'rebirth');
    assert.equal(revivals.length, 1, 'rebirth must not re-trigger');
    assert.equal(eventsOfType(result, 'death').filter((e) => e.targetUid?.includes('phoenix')).length, 1);
  });

  it('aegis turns aside the first attack only', () => {
    const library = fixtureLibrary([
      { id: 'warded', stats: { might: 1, vitality: 60, speed: 1 }, ability: 'aegis' },
      { id: 'striker', stats: { might: 8, vitality: 60, speed: 9 } },
    ]);
    const result = arena({ left: ['warded'], right: ['striker'], library, maxRounds: 8 });
    assert.equal(abilityEvents(result, 'aegis').length, 1);
  });

  it('thorns punishes the attacker', () => {
    const library = fixtureLibrary([
      { id: 'briar', stats: { might: 1, vitality: 80, speed: 1 }, ability: 'thorns' },
      { id: 'striker', stats: { might: 6, vitality: 60, speed: 9 } },
    ]);
    const result = arena({ left: ['briar'], right: ['striker'], library, maxRounds: 8 });
    assert.ok(abilityEvents(result, 'thorns').length > 0);
    const striker = result.players
      .find((player) => player.playerId === 'p2')
      ?.cards.find((card) => card.instanceId.startsWith('striker'));
    assert.ok(striker && striker.damageTaken > 0, 'the attacker should be bleeding');
  });

  it('venom keeps dealing damage after the attack', () => {
    const library = fixtureLibrary([
      { id: 'adder', stats: { might: 2, vitality: 80, speed: 9 }, ability: 'venom' },
      { id: 'lump', stats: { might: 1, vitality: 60, speed: 1 } },
    ]);
    const result = arena({ left: ['adder'], right: ['lump'], library, maxRounds: 10 });
    assert.ok(abilityEvents(result, 'venom').length > 0);
    const poison = result.log.filter((event) => event.message.includes('poison damage'));
    assert.ok(poison.length > 0, 'poison should tick on later rounds');
  });

  it('siphon heals the attacker for part of the damage dealt', () => {
    const library = fixtureLibrary([
      { id: 'leech', stats: { might: 10, vitality: 60, speed: 9 }, ability: 'siphon' },
      { id: 'lump', stats: { might: 6, vitality: 200, speed: 1 } },
    ]);
    const result = arena({ left: ['leech'], right: ['lump'], library, maxRounds: 10 });
    assert.ok(abilityEvents(result, 'siphon').length > 0);
  });

  it('doublestrike swings a second time', () => {
    const plain = fixtureLibrary([
      { id: 'hitter', stats: { might: 10, vitality: 40, speed: 9 } },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 } },
    ]);
    const double = fixtureLibrary([
      { id: 'hitter', stats: { might: 10, vitality: 40, speed: 9 }, ability: 'doublestrike' },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 } },
    ]);

    const damageIn = (library: CardLibrary) => {
      const result = arena({ left: ['hitter'], right: ['lump'], library, maxRounds: 6 });
      return (
        result.players
          .find((player) => player.playerId === 'p1')
          ?.cards.find((card) => card.instanceId.startsWith('hitter'))?.damageDealt ?? 0
      );
    };

    assert.ok(
      damageIn(double) > damageIn(plain),
      'doublestrike should out-damage the same card without it',
    );
  });

  it('hunt picks the weakest enemy rather than the front one', () => {
    const library = fixtureLibrary([
      { id: 'hunter', stats: { might: 12, vitality: 60, speed: 9 }, ability: 'hunt' },
      { id: 'tank', stats: { might: 1, vitality: 120, speed: 1 } },
      { id: 'weakling', stats: { might: 1, vitality: 14, speed: 1 } },
    ]);
    // `tank` is deployed first, so it holds the front slot.
    const result = arena({
      left: ['hunter'],
      right: ['tank', 'weakling'],
      library,
      maxRounds: 10,
    });
    const dead = eventsOfType(result, 'death').map((event) => event.targetUid ?? '');
    assert.ok(
      dead.some((uid) => uid.includes('weakling')),
      'the hunter should have gone for the weakling',
    );
  });

  it('bulwark hardens allies but not itself', () => {
    const library = fixtureLibrary([
      { id: 'warden', stats: { might: 1, vitality: 60, speed: 1 }, ability: 'bulwark' },
      { id: 'ally', stats: { might: 1, vitality: 60, speed: 2 } },
      { id: 'striker', stats: { might: 9, vitality: 200, speed: 9 } },
    ]);
    // The ally holds the front slot, so it is the one the aura has to protect.
    const withAura = arena({ left: ['ally', 'warden'], right: ['striker'], library, maxRounds: 8 });
    const solo = fixtureLibrary([
      { id: 'warden', stats: { might: 1, vitality: 60, speed: 1 } },
      { id: 'ally', stats: { might: 1, vitality: 60, speed: 2 } },
      { id: 'striker', stats: { might: 9, vitality: 200, speed: 9 } },
    ]);
    const without = arena({ left: ['ally', 'warden'], right: ['striker'], library: solo, maxRounds: 8 });

    const taken = (result: BattleResult) =>
      result.players
        .find((player) => player.playerId === 'p1')
        ?.cards.reduce((total, card) => total + card.damageTaken, 0) ?? 0;

    assert.ok(taken(withAura) < taken(without), 'the aura should soak damage');
  });

  it('dread weakens the enemy board as it lands', () => {
    const library = fixtureLibrary([
      { id: 'harbinger', stats: { might: 5, vitality: 60, speed: 5 }, ability: 'dread' },
      { id: 'grunt', stats: { might: 8, vitality: 60, speed: 5 } },
    ]);
    const result = arena({ left: ['grunt'], right: ['harbinger'], library, maxRounds: 8 });
    assert.ok(abilityEvents(result, 'dread').length > 0);
  });

  it('rally buffs allies already on the board', () => {
    const library = fixtureLibrary([
      { id: 'captain', stats: { might: 3, vitality: 40, speed: 3 }, ability: 'rally' },
      { id: 'soldier', stats: { might: 3, vitality: 40, speed: 3 } },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 } },
    ]);
    // The soldier lands first, so the captain arrives to an occupied board.
    const result = arena({ left: ['soldier', 'captain'], right: ['lump'], library, maxRounds: 8 });
    assert.ok(abilityEvents(result, 'rally').length > 0);
  });

  it('regrowth heals between rounds', () => {
    const library = fixtureLibrary([
      { id: 'sapling', stats: { might: 1, vitality: 60, speed: 1 }, ability: 'regrowth' },
      { id: 'striker', stats: { might: 5, vitality: 200, speed: 9 } },
    ]);
    const result = arena({ left: ['sapling'], right: ['striker'], library, maxRounds: 8 });
    assert.ok(abilityEvents(result, 'regrowth').length > 0);
  });

  it('frenzy grows the creature as it is hit', () => {
    const library = fixtureLibrary([
      { id: 'berserker', stats: { might: 3, vitality: 90, speed: 1 }, ability: 'frenzy' },
      { id: 'striker', stats: { might: 5, vitality: 200, speed: 9 } },
    ]);
    const result = arena({ left: ['berserker'], right: ['striker'], library, maxRounds: 10 });
    assert.ok(abilityEvents(result, 'frenzy').length > 1, 'frenzy should stack over several hits');
  });

  it('bloodlust rewards a kill', () => {
    const library = fixtureLibrary([
      { id: 'reaver', stats: { might: 30, vitality: 90, speed: 9 }, ability: 'bloodlust' },
      { id: 'fodder', stats: { might: 1, vitality: 10, speed: 1 } },
    ]);
    const result = arena({ left: ['reaver'], right: ['fodder', 'fodder'], library, maxRounds: 10 });
    assert.ok(abilityEvents(result, 'bloodlust').length > 0);
  });

  it('overwhelm carries excess damage to the nexus', () => {
    const library = fixtureLibrary([
      { id: 'crusher', stats: { might: 40, vitality: 90, speed: 9 }, ability: 'overwhelm' },
      { id: 'fodder', stats: { might: 1, vitality: 8, speed: 1 } },
    ]);
    const result = arena({ left: ['crusher'], right: ['fodder'], library, maxRounds: 8 });
    assert.ok(abilityEvents(result, 'overwhelm').length > 0);
  });

  it('warden puts up a shield on arrival', () => {
    const library = fixtureLibrary([
      { id: 'guardian', stats: { might: 1, vitality: 40, speed: 1 }, ability: 'warden' },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 } },
    ]);
    const result = arena({ left: ['guardian'], right: ['lump'], library, maxRounds: 4 });
    assert.ok(abilityEvents(result, 'warden').length > 0);
  });

  it('stoneform and ferocity change damage without changing the log shape', () => {
    const plain = fixtureLibrary([
      { id: 'striker', stats: { might: 20, vitality: 60, speed: 9 } },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 } },
    ]);
    const fierce = fixtureLibrary([
      { id: 'striker', stats: { might: 20, vitality: 60, speed: 9 }, ability: 'ferocity' },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 } },
    ]);
    const stony = fixtureLibrary([
      { id: 'striker', stats: { might: 20, vitality: 60, speed: 9 } },
      { id: 'lump', stats: { might: 1, vitality: 400, speed: 1 }, ability: 'stoneform' },
    ]);

    const dealt = (library: CardLibrary) => {
      const result = arena({ left: ['striker'], right: ['lump'], library, maxRounds: 6 });
      return (
        result.players
          .find((player) => player.playerId === 'p1')
          ?.cards.find((card) => card.instanceId.startsWith('striker'))?.damageDealt ?? 0
      );
    };

    assert.ok(dealt(fierce) > dealt(plain), 'ferocity should add damage');
    assert.ok(dealt(stony) < dealt(plain), 'stoneform should soak damage');
  });

  it('first strike moves a creature up the order', () => {
    const library = fixtureLibrary([
      { id: 'quick', stats: { might: 30, vitality: 40, speed: 5 }, ability: 'first-strike' },
      { id: 'slow', stats: { might: 30, vitality: 40, speed: 6 } },
    ]);
    const result = arena({ left: ['quick'], right: ['slow'], library, maxRounds: 10 });
    const attacks = eventsOfType(result, 'attack').filter((event) => event.round >= 2);
    assert.ok(attacks[0]?.actorUid?.includes('quick'), 'first strike should act before speed 6');
  });
});
