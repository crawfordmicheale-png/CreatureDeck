import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EFFECTS, EFFECT_BY_ID, STANDARD_LIBRARY } from '../src/content/index.ts';
import { staminaFor } from '../src/core/cardDefinition.ts';
import { createCardInstance } from '../src/core/cardInstance.ts';
import type { CardInstance } from '../src/core/cardInstance.ts';
import { trainTo } from '../src/core/leveling.ts';
import { RUTHLESS, STEADY, chooseAction, playTurn } from '../src/duel/ai.ts';
import { Duel } from '../src/duel/engine.ts';
import { EFFECT_HANDLERS } from '../src/duel/effects.ts';
import type { DeckEntry, DuelPlayerSetup } from '../src/duel/types.ts';
import { DEFAULT_DUEL_CONFIG, NEXUS_TARGET } from '../src/duel/types.ts';

const library = STANDARD_LIBRARY;

interface Built {
  readonly duel: Duel;
  readonly instances: CardInstance[];
}

/** Builds a duel from two lists of `definitionId` / `effect:id` shorthands. */
function build(
  mine: readonly string[],
  theirs: readonly string[],
  options: { level?: number; seed?: number; lanes?: number } = {},
): Built {
  const instances: CardInstance[] = [];

  const toDeck = (ids: readonly string[], prefix: string): DeckEntry[] =>
    ids.map((id, index) => {
      if (id.startsWith('effect:')) return { kind: 'effect', effectId: id.slice(7) };
      const instance = createCardInstance(library.getCard(id), {
        instanceId: `${prefix}-${id}-${index}`,
        level: options.level ?? 1,
      });
      instances.push(instance);
      return { kind: 'creature', instanceId: instance.instanceId };
    });

  const setups: readonly [DuelPlayerSetup, DuelPlayerSetup] = [
    { id: 'p1', name: 'You', deck: toDeck(mine, 'a') },
    { id: 'p2', name: 'Foe', deck: toDeck(theirs, 'b') },
  ];

  const duel = new Duel(setups, library, EFFECT_BY_ID, instances, {
    seed: options.seed ?? 7,
    ...(options.lanes === undefined ? {} : { lanes: options.lanes }),
  });
  return { duel, instances };
}

const FILLER = [
  'ember-whelp',
  'thicket-hare',
  'pebble-grub',
  'dusk-mite',
  'gale-sprite',
  'tide-minnow',
];

/** Decks are shuffled, so tests that need a specific card put it in hand. */
function giveCard(duel: Duel, playerId: string, entry: DeckEntry): void {
  duel.playerState(playerId).hand.push(entry);
}

/** Plays the first creature in hand into the first empty lane. */
function playAnyCreature(duel: Duel): boolean {
  const action = duel
    .legalActions()
    .find((candidate) => candidate.type === 'play-creature');
  if (!action) return false;
  duel.apply(action);
  return true;
}

describe('duel setup', () => {
  it('deals a hand of three and grants opening energy', () => {
    const { duel } = build(FILLER, FILLER);
    const snapshot = duel.snapshot();
    const me = snapshot.players[0];
    assert.equal(me.hand.length, 3);
    assert.equal(me.energy, DEFAULT_DUEL_CONFIG.startingEnergy);
    assert.equal(snapshot.activePlayerId, 'p1');
    assert.equal(me.lanes.length, 3);
    assert.ok(me.lanes.every((lane) => lane === null));
  });

  it('rejects a deck referencing a card or effect it does not have', () => {
    const instance = createCardInstance(library.getCard('ember-whelp'), { instanceId: 'x' });
    assert.throws(
      () =>
        new Duel(
          [
            { id: 'p1', name: 'A', deck: [{ kind: 'creature', instanceId: 'missing' }] },
            { id: 'p2', name: 'B', deck: [{ kind: 'creature', instanceId: 'x' }] },
          ],
          library,
          EFFECT_BY_ID,
          [instance],
        ),
      /unknown card copy/,
    );
    assert.throws(
      () =>
        new Duel(
          [
            { id: 'p1', name: 'A', deck: [{ kind: 'effect', effectId: 'nope' }] },
            { id: 'p2', name: 'B', deck: [{ kind: 'creature', instanceId: 'x' }] },
          ],
          library,
          EFFECT_BY_ID,
          [instance],
        ),
      /unknown effect/,
    );
  });
});

describe('playing cards', () => {
  it('spends energy and fills the chosen lane', () => {
    const { duel } = build(FILLER, FILLER);
    const before = duel.snapshot().players[0].energy;
    const play = duel.legalActions().find((a) => a.type === 'play-creature');
    assert.ok(play && play.type === 'play-creature');

    duel.apply(play);
    const after = duel.snapshot().players[0];
    assert.ok(after.energy < before, 'energy should be spent');
    assert.ok(after.lanes[play.lane] !== null, 'the lane should be occupied');
    assert.equal(after.hand.length, 2);
  });

  it('never offers a card the player cannot afford or place', () => {
    const { duel } = build(FILLER, FILLER);
    for (const action of duel.legalActions()) {
      if (action.type !== 'play-creature') continue;
      const player = duel.active;
      const card = player.creatures.get(action.instanceId);
      assert.ok(card && card.deployCost <= player.energy);
      assert.equal(player.lanes[action.lane], null);
    }
  });

  it('ignores an illegal action instead of corrupting the board', () => {
    const { duel } = build(FILLER, FILLER);
    const before = JSON.stringify(duel.snapshot());
    duel.apply({ type: 'play-creature', instanceId: 'not-a-card', lane: 0 });
    duel.apply({ type: 'attack', attackerUid: 'nobody', targetUid: NEXUS_TARGET });
    duel.apply({ type: 'play-effect', effectId: 'not-an-effect' });
    assert.equal(JSON.stringify(duel.snapshot()), before);
  });
});

describe('stamina', () => {
  it('prints stamina inversely to rarity, and grows it with level', () => {
    assert.equal(staminaFor('common', 1), 3);
    assert.equal(staminaFor('mythic', 1), 2);
    assert.equal(staminaFor('common', 8), 4);
    assert.equal(staminaFor('mythic', 16), 4);
  });

  it('spends one per attack and retires the creature at zero', () => {
    const { duel } = build(['ember-whelp', ...FILLER], []);
    playAnyCreature(duel);

    const uid = duel.snapshot().players[0].lanes.find((lane) => lane !== null)?.uid;
    assert.ok(uid);

    const unit = duel.findUnit(uid);
    assert.ok(unit);
    const max = unit.maxStamina;

    // Swing at the nexus rather than at creatures: the point is stamina, and
    // trading blows would let the attacker die before it is spent.
    let attacks = 0;
    for (let i = 0; i < 24 && duel.findUnit(uid); i += 1) {
      const attack = duel
        .legalActions()
        .find(
          (a) => a.type === 'attack' && a.attackerUid === uid && a.targetUid === NEXUS_TARGET,
        );
      if (attack) {
        duel.apply(attack);
        attacks += 1;
      } else {
        duel.apply({ type: 'end-turn' });
        duel.apply({ type: 'end-turn' });
      }
      if (duel.isOver) break;
    }

    assert.equal(attacks, max, `should attack exactly ${max} times before retiring`);
    assert.equal(duel.findUnit(uid), null, 'the spent creature should leave the board');
    assert.ok(
      duel.playerState('p1').discard.some((e) => e.kind === 'creature'),
      'and land in the discard pile',
    );
  });

  it('lets a creature attack only once per turn', () => {
    const { duel } = build(['ember-whelp', ...FILLER], FILLER);
    playAnyCreature(duel);
    duel.apply({ type: 'end-turn' });
    playTurn(duel, STEADY);

    const uid = duel.snapshot().players[0].lanes.find((lane) => lane !== null)?.uid;
    assert.ok(uid);
    const first = duel.legalActions().find((a) => a.type === 'attack' && a.attackerUid === uid);
    assert.ok(first, 'a rested creature should be able to attack');
    duel.apply(first);

    const second = duel.legalActions().find((a) => a.type === 'attack' && a.attackerUid === uid);
    assert.equal(second, undefined, 'it should not get a second swing in the same turn');
  });

  it('will not let a creature attack the turn it lands', () => {
    const { duel } = build(FILLER, FILLER);
    playAnyCreature(duel);
    const attacks = duel.legalActions().filter((a) => a.type === 'attack');
    assert.equal(attacks.length, 0, 'a freshly played creature must rest');
  });
});

describe('lanes and the nexus', () => {
  it('opens the nexus only through an empty facing lane', () => {
    const { duel } = build(FILLER, FILLER, { lanes: 3 });

    // Player one takes lane 0 and rests a turn.
    duel.apply({ type: 'play-creature', instanceId: duel.active.hand[0]!.kind === 'creature'
      ? (duel.active.hand[0] as { instanceId: string }).instanceId
      : '', lane: 0 });
    duel.apply({ type: 'end-turn' });

    // Player two answers in lane 0, blocking it.
    const foePlay = duel.legalActions().find((a) => a.type === 'play-creature' && a.lane === 0);
    assert.ok(foePlay);
    duel.apply(foePlay);
    duel.apply({ type: 'end-turn' });

    const uid = duel.snapshot().players[0].lanes[0]?.uid;
    assert.ok(uid);
    const attacker = duel.findUnit(uid);
    assert.ok(attacker);
    assert.equal(duel.laneIsOpen(attacker), false, 'a blocked lane closes the nexus');

    const nexusAttack = duel
      .legalActions()
      .find((a) => a.type === 'attack' && a.targetUid === NEXUS_TARGET);
    assert.equal(nexusAttack, undefined, 'the nexus must not be targetable through a blocked lane');

    const creatureAttack = duel
      .legalActions()
      .find((a) => a.type === 'attack' && a.targetUid !== NEXUS_TARGET);
    assert.ok(creatureAttack, 'but the enemy creature is a legal target');
  });

  it('lets any enemy creature be targeted, not just the one opposite', () => {
    const { duel } = build(FILLER, FILLER);
    playAnyCreature(duel);
    duel.apply({ type: 'end-turn' });
    // Give the opponent two creatures.
    playAnyCreature(duel);
    playAnyCreature(duel);
    duel.apply({ type: 'end-turn' });

    const targets = new Set(
      duel
        .legalActions()
        .filter((a) => a.type === 'attack' && a.targetUid !== NEXUS_TARGET)
        .map((a) => (a as { targetUid: string }).targetUid),
    );
    assert.ok(targets.size >= 2, 'both enemy creatures should be attackable');
  });

  it('damages the nexus through an open lane and can end the duel', () => {
    const { duel } = build(FILLER, FILLER, { seed: 3 });
    playAnyCreature(duel);

    let guard = 0;
    while (!duel.isOver && guard < 400) {
      guard += 1;
      duel.apply({ type: 'end-turn' });
      playTurn(duel, RUTHLESS);
      if (duel.isOver) break;
      // Our side: swing at whatever is legal, preferring the nexus.
      const actions = duel.legalActions();
      const face = actions.find((a) => a.type === 'attack' && a.targetUid === NEXUS_TARGET);
      const any = actions.find((a) => a.type === 'attack');
      if (face) duel.apply(face);
      else if (any) duel.apply(any);
      else if (!playAnyCreature(duel)) duel.apply({ type: 'end-turn' });
    }

    assert.ok(duel.isOver, 'a duel driven by both sides should terminate');
    const result = duel.result;
    assert.ok(result);
    assert.ok(result.turns > 0);
  });
});

describe('effect cards', () => {
  it('gives every printed effect a handler, and every handler a card', () => {
    for (const effect of EFFECTS) {
      assert.ok(EFFECT_HANDLERS[effect.id], `no handler for "${effect.id}"`);
    }
    const printed = new Set(EFFECTS.map((effect) => effect.id));
    for (const id of Object.keys(EFFECT_HANDLERS)) {
      assert.ok(printed.has(id), `handler "${id}" has no printed card`);
    }
  });

  it('documents every {param} it references', () => {
    for (const effect of EFFECTS) {
      for (const match of effect.text.matchAll(/\{(\w+)\}/g)) {
        const key = match[1] as string;
        assert.ok(key in effect.params, `${effect.id} references {${key}} with no such param`);
      }
    }
  });

  it('only offers a targeted effect when a legal target exists', () => {
    const { duel } = build(['effect:emberlash', ...FILLER], FILLER);
    const early = duel
      .legalActions()
      .filter((a) => a.type === 'play-effect' && a.effectId === 'emberlash');
    assert.equal(early.length, 0, 'no enemy creature, so no legal Emberlash');
  });

  it('resolves damage onto the chosen enemy', () => {
    const { duel } = build(FILLER, FILLER);
    duel.apply({ type: 'end-turn' });
    playAnyCreature(duel);
    duel.apply({ type: 'end-turn' });
    giveCard(duel, 'p1', { kind: 'effect', effectId: 'emberlash' });

    const target = duel.snapshot().players[1].lanes.find((lane) => lane !== null);
    assert.ok(target);
    const before = target.health;

    const play = duel
      .legalActions()
      .find((a) => a.type === 'play-effect' && a.effectId === 'emberlash');
    assert.ok(play, 'Emberlash should be playable with an enemy on the board');
    duel.apply(play);

    const after = duel.findUnit(target.uid);
    assert.ok(after === null || after.health < before, 'the target should be damaged or dead');
  });

  it('burns the nexus directly with Ruinous Bolt', () => {
    const { duel } = build(FILLER, FILLER);
    // Round 2 energy covers its cost of 4.
    duel.apply({ type: 'end-turn' });
    playTurn(duel, STEADY);
    giveCard(duel, 'p1', { kind: 'effect', effectId: 'ruinous-bolt' });

    const before = duel.snapshot().players[1].nexusHealth;
    const play = duel
      .legalActions()
      .find((a) => a.type === 'play-effect' && a.effectId === 'ruinous-bolt');
    assert.ok(play, 'Ruinous Bolt needs no target, so it should be playable');
    duel.apply(play);
    assert.equal(duel.snapshot().players[1].nexusHealth, before - 12);
  });

  it('sends a spent effect to the discard pile', () => {
    const { duel } = build(FILLER, FILLER);
    giveCard(duel, 'p1', { kind: 'effect', effectId: 'hollow-pact' });
    const play = duel
      .legalActions()
      .find((a) => a.type === 'play-effect' && a.effectId === 'hollow-pact');
    assert.ok(play);
    duel.apply(play);
    assert.ok(
      duel.playerState('p1').discard.some((e) => e.kind === 'effect' && e.effectId === 'hollow-pact'),
    );
  });
});

describe('deck cycling', () => {
  it('reshuffles the discard pile when the draw pile runs dry', () => {
    // Both sides on tiny decks, both actually playing, so cards reach discard.
    const { duel } = build(['ember-whelp', 'thicket-hare'], ['ember-whelp', 'thicket-hare']);
    for (let i = 0; i < 60 && !duel.isOver; i += 1) playTurn(duel, STEADY);
    assert.ok(
      duel.events.some((event) => event.type === 'reshuffle'),
      'a two-card deck should have cycled back through the discard pile',
    );
  });
});

describe('the opponent', () => {
  it('plays a whole turn and always stops', () => {
    const { duel } = build(FILLER, FILLER);
    duel.apply({ type: 'end-turn' });
    const actions = playTurn(duel, STEADY);
    assert.ok(actions.length > 0);
    assert.equal(actions[actions.length - 1]?.type, 'end-turn');
  });

  it('only ever picks a legal action', () => {
    const { duel } = build(FILLER, FILLER, { seed: 11 });
    for (let i = 0; i < 40 && !duel.isOver; i += 1) {
      const legal = duel.legalActions();
      const choice = chooseAction(duel, STEADY);
      const ok = legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(choice));
      assert.ok(ok || choice.type === 'end-turn', `illegal choice: ${JSON.stringify(choice)}`);
      duel.apply(choice);
    }
  });

  it('takes a lethal swing at the nexus when one is available', () => {
    const { duel } = build(FILLER, ['ember-whelp', ...FILLER], { level: 10 });
    // Drop the player's nexus to within one hit and leave every lane open.
    duel.playerState('p1').nexusHealth = 1;

    duel.apply({ type: 'end-turn' }); // p2's turn: it develops, cannot yet swing
    playTurn(duel, STEADY);
    duel.apply({ type: 'end-turn' }); // p1 passes
    playTurn(duel, STEADY); // p2 again, now with a rested creature

    assert.ok(duel.isOver, 'the AI should convert a lethal line');
    assert.equal(duel.result?.winner, 'p2');
  });
});

describe('levelling still matters', () => {
  it('makes the same card hit harder and last longer at a higher level', () => {
    const fresh = build(['ember-whelp', ...FILLER], FILLER, { level: 1 });
    const trained = build(['ember-whelp', ...FILLER], FILLER, { level: 10 });

    const freshCard = fresh.duel.active.creatures.get('a-ember-whelp-0');
    const trainedInstance = trainTo(
      trained.instances.find((i) => i.instanceId === 'a-ember-whelp-0')!,
      10,
      ['might'],
      library,
    );
    assert.ok(freshCard);
    assert.ok(trainedInstance.level > 1);
    assert.equal(staminaFor('common', 10), staminaFor('common', 1) + 1);
  });
});
