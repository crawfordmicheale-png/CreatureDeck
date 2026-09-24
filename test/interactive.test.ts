import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GREEDY_CONTROLLER } from '../src/battle/controllers.ts';
import { playBattle, runBattle } from '../src/battle/engine.ts';
import type { BattlePlayerSetup } from '../src/battle/engine.ts';
import type { BattleStep, DeploymentReply } from '../src/battle/types.ts';
import { STANDARD_LIBRARY } from '../src/content/index.ts';
import { createCardInstance } from '../src/core/cardInstance.ts';

const library = STANDARD_LIBRARY;

const DECK = [
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

function setups(): readonly [BattlePlayerSetup, BattlePlayerSetup] {
  const build = (prefix: string) =>
    DECK.map((id, i) => createCardInstance(library.getCard(id), { instanceId: `${prefix}-${id}-${i}` }));
  return [
    { id: 'p1', name: 'You', deck: build('a'), controller: GREEDY_CONTROLLER },
    { id: 'p2', name: 'Foe', deck: build('b'), controller: GREEDY_CONTROLLER },
  ];
}

/** Drives an interactive battle with a policy for each deployment prompt. */
function drive(choose: (step: Extract<BattleStep, { kind: 'deployment' }>) => DeploymentReply) {
  const generator = playBattle(setups(), library, ['p1'], { seed: 9001 });
  const steps: BattleStep[] = [];
  let step = generator.next();
  let guard = 0;

  while (!step.done) {
    guard += 1;
    assert.ok(guard < 5000, 'interactive battle failed to terminate');
    steps.push(step.value);
    step = generator.next(step.value.kind === 'deployment' ? choose(step.value) : undefined);
  }

  return { result: step.value, steps };
}

describe('interactive battles', () => {
  it('pauses for the interactive player and never for the AI', () => {
    const { steps } = drive(() => null);
    const prompts = steps.filter((step) => step.kind === 'deployment');
    assert.ok(prompts.length > 0, 'the human player should have been asked to deploy');
    for (const prompt of prompts) {
      assert.equal(prompt.playerId, 'p1', 'only p1 is interactive');
    }
  });

  it('only ever offers cards the player can actually afford', () => {
    drive((step) => {
      for (const card of step.playable) {
        assert.ok(
          card.deployCost <= step.energy,
          `offered ${card.name} at ${card.deployCost} with ${step.energy} energy`,
        );
      }
      return null;
    });
  });

  it('deploys exactly what the caller asks for', () => {
    const asked: string[] = [];
    const { steps } = drive((step) => {
      const pick = step.playable[0];
      if (!pick || asked.includes(pick.instanceId)) return null;
      asked.push(pick.instanceId);
      return pick.instanceId;
    });

    assert.ok(asked.length > 0, 'nothing was ever deployed');

    // Check the log rather than the board: a creature can be deployed and
    // killed inside the same round, and never appear in a later snapshot.
    const deployLog = steps
      .flatMap((step) => step.events)
      .filter((event) => event.type === 'deploy' && event.playerId === 'p1')
      .map((event) => event.actorUid ?? '');

    for (const instanceId of asked) {
      assert.ok(
        deployLog.some((uid) => uid.endsWith(instanceId)),
        `${instanceId} was never deployed`,
      );
    }
  });

  it('ends a deployment phase on its own once nothing can be played', () => {
    // Always says yes to the first option; must still terminate.
    const { result } = drive((step) => step.playable[0]?.instanceId ?? null);
    assert.ok(result.rounds >= 1);
  });

  it('ignores an unknown card without ending the turn', () => {
    let rejected = false;
    const { result, steps } = drive((step) => {
      if (!rejected) {
        rejected = true;
        return 'no-such-card';
      }
      return null;
    });

    assert.equal(rejected, true);
    // A rejected pick must not have ended that player's deployment phase.
    const round1Prompts = steps.filter(
      (step) => step.kind === 'deployment' && step.round === 1,
    );
    assert.ok(round1Prompts.length >= 2, 'a bad pick should not end the turn');
    assert.ok(result.rounds >= 1);
  });

  it('reaches the same result as runBattle when it defers to the controller', () => {
    // Replaying the greedy controller's own picks must reproduce the headless battle.
    const headless = runBattle(setups(), library, { seed: 9001 });
    const { result } = drive((step) => {
      const ranked = [...step.playable].sort(
        (a, b) => b.deployCost - a.deployCost || b.powerScore - a.powerScore,
      );
      return ranked[0]?.instanceId ?? null;
    });
    assert.equal(result.winner, headless.winner);
    assert.equal(result.rounds, headless.rounds);
  });

  it('hands over fresh events and a drawable snapshot at every step', () => {
    const { steps } = drive(() => null);
    for (const step of steps) {
      assert.equal(step.snapshot.players.length, 2);
      for (const player of step.snapshot.players) {
        assert.ok(player.nexusHealth >= 0);
        assert.equal(player.board.length, 5);
      }
    }
    const total = steps.reduce((sum, step) => sum + step.events.length, 0);
    assert.ok(total > 0, 'no events were ever handed over');
  });
});
