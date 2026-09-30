/**
 * The opponent.
 *
 * It picks from exactly the same `legalActions` list a player sees, one action
 * at a time, so it can never do something the rules would not let you do.
 * Deliberately a readable heuristic rather than a search: it should feel like
 * a competent opponent, not an unbeatable one.
 */

import type { Duel } from './engine.ts';
import type { DuelAction } from './types.ts';
import { NEXUS_TARGET } from './types.ts';

export interface AiProfile {
  readonly name: string;
  /** 0 plays for the board, 1 plays for the face. */
  readonly aggression: number;
}

export const CAUTIOUS: AiProfile = { name: 'Cautious', aggression: 0.15 };
export const STEADY: AiProfile = { name: 'Steady', aggression: 0.45 };
export const RUTHLESS: AiProfile = { name: 'Ruthless', aggression: 0.8 };

/**
 * One action for the active player, or `end-turn` when there is nothing worth
 * doing. Call it in a loop until it returns `end-turn`.
 */
export function chooseAction(duel: Duel, profile: AiProfile = STEADY): DuelAction {
  const actions = duel.legalActions();
  if (actions.length === 0) return { type: 'end-turn' };

  const active = duel.active;
  const enemyId = duel.opponentOf(active.id);
  const enemy = duel.playerState(enemyId);

  // 1. Win outright if the nexus is in reach this turn.
  const nexusAttacks = duel
    .attackOptions()
    .filter((option) => option.targetUid === NEXUS_TARGET);
  const reachable = nexusAttacks.reduce((sum, option) => sum + option.damage, 0);
  if (reachable >= enemy.nexusHealth && nexusAttacks.length > 0) {
    const best = nexusAttacks[0]!;
    return { type: 'attack', attackerUid: best.attackerUid, targetUid: NEXUS_TARGET };
  }

  // 2. Take a free kill, preferring the most dangerous creature removed.
  const kills = duel
    .attackOptions()
    .filter((option) => option.targetUid !== NEXUS_TARGET && option.lethal)
    .map((option) => ({ option, threat: duel.findUnit(option.targetUid)?.might ?? 0 }))
    .sort((a, b) => b.threat - a.threat);
  if (kills.length > 0) {
    const pick = kills[0]!.option;
    return { type: 'attack', attackerUid: pick.attackerUid, targetUid: pick.targetUid };
  }

  // 3. Develop the board while there is room and energy.
  const plays = actions.filter(
    (action): action is Extract<DuelAction, { type: 'play-creature' }> =>
      action.type === 'play-creature',
  );
  if (plays.length > 0) {
    const ranked = plays
      .map((action) => ({
        action,
        score: active.creatures.get(action.instanceId)?.powerScore ?? 0,
        // Prefer a lane the enemy has left open, so the nexus stays reachable.
        open: enemy.lanes[action.lane] == null ? 1 : 0,
      }))
      .sort((a, b) => b.open - a.open || b.score - a.score);
    const best = ranked[0];
    if (best) return best.action;
  }

  // 4. Spend an effect when it clearly earns its energy.
  const effect = chooseEffect(duel, actions);
  if (effect) return effect;

  // 5. Chip the nexus, or trade into the board.
  const remaining = duel.attackOptions();
  if (remaining.length > 0) {
    const face = remaining.filter((option) => option.targetUid === NEXUS_TARGET);
    const trades = remaining.filter((option) => option.targetUid !== NEXUS_TARGET);

    const goFace = face.length > 0 && (trades.length === 0 || active.rng.next() < profile.aggression);
    if (goFace) {
      const pick = face[0]!;
      return { type: 'attack', attackerUid: pick.attackerUid, targetUid: NEXUS_TARGET };
    }
    if (trades.length > 0) {
      // Hit whatever this swing hurts most relative to what is left of it.
      const ranked = [...trades].sort((a, b) => {
        const ua = duel.findUnit(a.targetUid);
        const ub = duel.findUnit(b.targetUid);
        const ra = ua ? a.damage / Math.max(1, ua.health + ua.shield) : 0;
        const rb = ub ? b.damage / Math.max(1, ub.health + ub.shield) : 0;
        return rb - ra;
      });
      const pick = ranked[0]!;
      return { type: 'attack', attackerUid: pick.attackerUid, targetUid: pick.targetUid };
    }
  }

  return { type: 'end-turn' };
}

function chooseEffect(duel: Duel, actions: readonly DuelAction[]): DuelAction | null {
  const plays = actions.filter(
    (action): action is Extract<DuelAction, { type: 'play-effect' }> =>
      action.type === 'play-effect',
  );
  if (plays.length === 0) return null;

  const active = duel.active;
  const enemyId = duel.opponentOf(active.id);

  // Removal first: finish something off if an effect can.
  for (const play of plays) {
    const effect = duel.effects.get(play.effectId);
    if (!effect || !play.targetUid) continue;
    const target = duel.findUnit(play.targetUid);
    if (!target || target.ownerId !== enemyId) continue;
    const damage = effect.params['damage'] ?? 0;
    if (damage > 0 && damage >= target.health + target.shield) return play;
  }

  // Reach: burn the nexus when it is nearly down.
  const enemy = duel.playerState(enemyId);
  for (const play of plays) {
    const effect = duel.effects.get(play.effectId);
    if (effect?.id === 'ruinous-bolt' && (effect.params['damage'] ?? 0) >= enemy.nexusHealth) {
      return play;
    }
  }

  // A sweep that hits at least two creatures is worth the card.
  for (const play of plays) {
    const effect = duel.effects.get(play.effectId);
    if (effect?.id !== 'cinderbloom') continue;
    if (duel.unitsOf(enemyId).filter((unit) => unit.alive).length >= 2) return play;
  }

  // Healing, only when it actually restores something.
  for (const play of plays) {
    const effect = duel.effects.get(play.effectId);
    if (!effect || !play.targetUid) continue;
    const target = duel.findUnit(play.targetUid);
    if (!target || target.ownerId !== active.id) continue;
    const heal = effect.params['heal'] ?? 0;
    if (heal > 0 && target.maxHealth - target.health >= heal) return play;
  }

  // Draw when the hand is nearly empty.
  for (const play of plays) {
    const effect = duel.effects.get(play.effectId);
    if (effect?.id === 'hollow-pact' && active.hand.length <= 2) return play;
  }

  return null;
}

/** Plays the active player's whole turn. Returns the actions it took. */
export function playTurn(duel: Duel, profile: AiProfile = STEADY, limit = 40): DuelAction[] {
  const taken: DuelAction[] = [];
  for (let i = 0; i < limit; i += 1) {
    if (duel.isOver) break;
    const action = chooseAction(duel, profile);
    taken.push(action);
    duel.apply(action);
    if (action.type === 'end-turn') break;
  }
  return taken;
}
