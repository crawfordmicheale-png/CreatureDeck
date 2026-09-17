/**
 * Deployment policies.
 *
 * A controller only decides *what to put on the board this round*. Combat
 * itself is automatic, so this is the whole of the AI surface — and the same
 * interface a human front-end implements.
 */

import type { ResolvedCard } from '../core/cardInstance.ts';
import type { Controller, ControllerView } from './types.ts';

function affordable(view: ControllerView): ResolvedCard[] {
  return view.hand.filter((card) => card.deployCost <= view.energy);
}

function idsOf(cards: readonly ResolvedCard[]): string[] {
  return cards.map((card) => card.instance.instanceId);
}

/**
 * Commits to the biggest thing it can pay for, then fills the remaining
 * energy with whatever else fits. Simple, and surprisingly hard to beat.
 */
export const GREEDY_CONTROLLER: Controller = {
  name: 'Greedy',
  chooseDeployments(view) {
    const ranked = affordable(view).sort(
      (a, b) => b.deployCost - a.deployCost || b.powerScore - a.powerScore,
    );
    return idsOf(ranked);
  },
};

/**
 * Buys power score per point of energy. Tends to flood the board with
 * well-levelled cheap cards rather than holding out for one expensive one.
 */
export const VALUE_CONTROLLER: Controller = {
  name: 'Value',
  chooseDeployments(view) {
    const ranked = affordable(view).sort(
      (a, b) =>
        b.powerScore / b.deployCost - a.powerScore / a.deployCost || b.powerScore - a.powerScore,
    );
    return idsOf(ranked);
  },
};

/** Plays the cheapest cards first to contest the board as early as possible. */
export const SWARM_CONTROLLER: Controller = {
  name: 'Swarm',
  chooseDeployments(view) {
    const ranked = affordable(view).sort(
      (a, b) => a.deployCost - b.deployCost || b.powerScore - a.powerScore,
    );
    return idsOf(ranked);
  },
};

export function createRandomController(name = 'Random'): Controller {
  return {
    name,
    chooseDeployments(view) {
      return idsOf(view.rng.shuffle(affordable(view)));
    },
  };
}

/** Deploys exactly the instance ids given, in order — useful in tests. */
export function createScriptedController(script: readonly string[], name = 'Scripted'): Controller {
  return {
    name,
    chooseDeployments() {
      return script;
    },
  };
}

export const CONTROLLERS: Readonly<Record<string, Controller>> = {
  greedy: GREEDY_CONTROLLER,
  value: VALUE_CONTROLLER,
  swarm: SWARM_CONTROLLER,
};
