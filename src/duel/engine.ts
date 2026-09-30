/**
 * The duel engine.
 *
 * A state machine, not a simulation: it only moves when `apply` is called with
 * an action. `legalActions` says what may be done right now, so a front-end
 * never has to duplicate the rules to grey out a button, and the AI picks from
 * the same list a player sees.
 */

import type { AbilityDefinition } from '../core/abilities.ts';
import type { CardInstance, ResolvedCard } from '../core/cardInstance.ts';
import { resolveCard } from '../core/cardInstance.ts';
import { staminaFor } from '../core/cardDefinition.ts';
import type { EffectDefinition } from '../core/effects.ts';
import { effectText } from '../core/effects.ts';
import type { CardLibrary } from '../core/library.ts';
import type { Rng } from '../core/rng.ts';
import { createRng } from '../core/rng.ts';
import { abilityText, duelHooks } from './abilities.ts';
import { effectHandler } from './effects.ts';
import type {
  AttackOption,
  DamageKind,
  DeckEntry,
  DuelAbilityHooks,
  DuelAction,
  DuelApi,
  DuelConfig,
  DuelEndReason,
  DuelEvent,
  DuelPlayerSetup,
  DuelPlayerSnapshot,
  DuelResult,
  DuelSnapshot,
  DuelUnit,
  HandSnapshot,
  UnitSnapshot,
} from './types.ts';
import { DEFAULT_DUEL_CONFIG, NEXUS_TARGET } from './types.ts';

const MAX_DODGE_PERCENT = 20;
const DODGE_PER_SPEED = 1.2;

interface PlayerState {
  readonly id: string;
  readonly name: string;
  nexusHealth: number;
  energy: number;
  draw: DeckEntry[];
  hand: DeckEntry[];
  discard: DeckEntry[];
  lanes: (DuelUnit | null)[];
  readonly creatures: Map<string, ResolvedCard>;
  readonly rng: Rng;
}

interface DamageOutcome {
  readonly applied: number;
  readonly overkill: number;
  readonly killed: boolean;
}

/** Art filename for a card, resolved by the front-end against its asset map. */
function artKey(id: string): string {
  return id;
}

export class Duel implements DuelApi {
  readonly config: DuelConfig;
  readonly library: CardLibrary;
  readonly effects: ReadonlyMap<string, EffectDefinition>;
  readonly players: [PlayerState, PlayerState];
  readonly events: DuelEvent[] = [];

  turn = 0;
  activeIndex = 0;
  private units: DuelUnit[] = [];
  private uidSeed = 0;
  private drained = 0;
  private ended: DuelResult | null = null;

  constructor(
    setups: readonly [DuelPlayerSetup, DuelPlayerSetup],
    library: CardLibrary,
    effects: ReadonlyMap<string, EffectDefinition>,
    instances: readonly CardInstance[],
    config: Partial<DuelConfig> = {},
  ) {
    this.config = { ...DEFAULT_DUEL_CONFIG, ...config };
    this.library = library;
    this.effects = effects;

    const rng = createRng(this.config.seed);
    const byId = new Map(instances.map((instance) => [instance.instanceId, instance]));

    this.players = [
      this.makePlayer(setups[0], byId, rng.fork(1)),
      this.makePlayer(setups[1], byId, rng.fork(2)),
    ];

    this.beginTurn();
  }

  private makePlayer(
    setup: DuelPlayerSetup,
    byId: ReadonlyMap<string, CardInstance>,
    rng: Rng,
  ): PlayerState {
    const creatures = new Map<string, ResolvedCard>();
    for (const entry of setup.deck) {
      if (entry.kind !== 'creature') continue;
      const instance = byId.get(entry.instanceId);
      if (!instance) throw new Error(`Deck references unknown card copy "${entry.instanceId}".`);
      creatures.set(entry.instanceId, resolveCard(instance, this.library));
    }
    for (const entry of setup.deck) {
      if (entry.kind === 'effect' && !this.effects.has(entry.effectId)) {
        throw new Error(`Deck references unknown effect "${entry.effectId}".`);
      }
    }

    return {
      id: setup.id,
      name: setup.name,
      nexusHealth: this.config.nexusHealth,
      energy: 0,
      draw: rng.shuffle(setup.deck),
      hand: [],
      discard: [],
      lanes: new Array<DuelUnit | null>(this.config.lanes).fill(null),
      creatures,
      rng,
    };
  }

  // ------------------------------------------------------------------ access

  get active(): PlayerState {
    return this.players[this.activeIndex] as PlayerState;
  }

  get idle(): PlayerState {
    return this.players[1 - this.activeIndex] as PlayerState;
  }

  get round(): number {
    return Math.floor(this.turn / 2) + 1;
  }

  playerState(playerId: string): PlayerState {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error(`Unknown player "${playerId}".`);
    return player;
  }

  opponentOf(playerId: string): string {
    const [first, second] = this.players;
    return playerId === first.id ? second.id : first.id;
  }

  unitsOf(playerId: string): readonly DuelUnit[] {
    return this.playerState(playerId).lanes.filter((lane): lane is DuelUnit => lane !== null);
  }

  alliesOf(unit: DuelUnit): readonly DuelUnit[] {
    return this.unitsOf(unit.ownerId);
  }

  enemiesOf(unit: DuelUnit): readonly DuelUnit[] {
    return this.unitsOf(this.opponentOf(unit.ownerId));
  }

  findUnit(uid: string): DuelUnit | null {
    return this.units.find((unit) => unit.uid === uid && unit.alive) ?? null;
  }

  log(event: Omit<DuelEvent, 'turn'>): void {
    this.events.push({ turn: this.turn, ...event });
  }

  /** Events appended since the last drain, for animating a chunk. */
  drain(): readonly DuelEvent[] {
    const fresh = this.events.slice(this.drained);
    this.drained = this.events.length;
    return fresh;
  }

  // ------------------------------------------------------------- ability glue

  private eachAbility(
    unit: DuelUnit,
    visit: (hooks: DuelAbilityHooks, ability: AbilityDefinition) => void,
  ): void {
    for (const ability of unit.abilities) {
      const hooks = duelHooks(ability.id);
      if (hooks) visit(hooks, ability);
    }
  }

  private effectiveSpeed(unit: DuelUnit): number {
    let speed = unit.speed;
    this.eachAbility(unit, (hooks, ability) => {
      if (hooks.speedBonus) speed += hooks.speedBonus(ability);
    });
    return speed;
  }

  effectiveGuard(unit: DuelUnit): number {
    let guard = unit.guard;
    for (const ally of this.alliesOf(unit)) {
      if (!ally.alive || ally.uid === unit.uid) continue;
      this.eachAbility(ally, (hooks, ability) => {
        if (hooks.allyGuardBonus) guard += hooks.allyGuardBonus(ability);
      });
    }
    return guard;
  }

  private isPiercing(unit: DuelUnit): boolean {
    let piercing = false;
    this.eachAbility(unit, (hooks, ability) => {
      if (hooks.piercing && hooks.piercing(ability)) piercing = true;
    });
    return piercing;
  }

  // -------------------------------------------------------------- DuelApi ops

  heal(target: DuelUnit, amount: number): number {
    if (!target.alive || amount <= 0) return 0;
    const healed = Math.min(amount, target.maxHealth - target.health);
    target.health += healed;
    return healed;
  }

  grantShield(target: DuelUnit, amount: number): void {
    if (target.alive && amount > 0) target.shield += amount;
  }

  buffMight(target: DuelUnit, amount: number): void {
    target.might = Math.max(0, target.might + amount);
  }

  addPoison(target: DuelUnit, stacks: number): void {
    if (target.alive && stacks > 0) target.poison += stacks;
  }

  clearPoison(target: DuelUnit): void {
    target.poison = 0;
  }

  changeStamina(target: DuelUnit, delta: number): void {
    if (!target.alive) return;
    target.stamina = Math.max(0, Math.min(target.maxStamina, target.stamina + delta));
    if (target.stamina === 0) this.retire(target, 'spent');
  }

  damageNexus(playerId: string, amount: number): void {
    if (amount <= 0) return;
    const player = this.playerState(playerId);
    player.nexusHealth = Math.max(0, player.nexusHealth - amount);
    this.log({
      type: 'nexus-damage',
      playerId,
      amount,
      message: `${player.name}'s nexus takes ${amount} (${player.nexusHealth} left).`,
    });
  }

  drawCards(playerId: string, count: number): void {
    const player = this.playerState(playerId);
    for (let i = 0; i < count; i += 1) {
      if (player.draw.length === 0) {
        if (player.discard.length === 0) return;
        player.draw = player.rng.shuffle(player.discard);
        player.discard = [];
        this.log({
          type: 'reshuffle',
          playerId,
          message: `${player.name} shuffles the discard pile back into the deck.`,
        });
      }
      const entry = player.draw.shift();
      if (!entry) return;
      player.hand.push(entry);
    }
  }

  /** Pulls the strongest creature out of the discard pile, fully rested. */
  recoverCreature(playerId: string): string | null {
    const player = this.playerState(playerId);
    let bestIndex = -1;
    let bestScore = -1;
    player.discard.forEach((entry, index) => {
      if (entry.kind !== 'creature') return;
      const card = player.creatures.get(entry.instanceId);
      if (card && card.powerScore > bestScore) {
        bestScore = card.powerScore;
        bestIndex = index;
      }
    });
    if (bestIndex === -1) return null;
    const [entry] = player.discard.splice(bestIndex, 1);
    if (!entry || entry.kind !== 'creature') return null;
    player.hand.push(entry);
    return player.creatures.get(entry.instanceId)?.displayName ?? entry.instanceId;
  }

  damage(
    target: DuelUnit,
    amount: number,
    kind: DamageKind,
    source: DuelUnit | null,
  ): number {
    return this.dealDamage(target, amount, kind, source).applied;
  }

  private dealDamage(
    target: DuelUnit,
    amount: number,
    kind: DamageKind,
    source: DuelUnit | null,
  ): DamageOutcome {
    if (!target.alive) return { applied: 0, overkill: 0, killed: false };

    let modified = amount;
    this.eachAbility(target, (hooks, ability) => {
      if (hooks.incomingDamage) {
        modified = hooks.incomingDamage(this, target, ability, kind, modified);
      }
    });
    modified = Math.max(0, Math.round(modified));
    if (modified === 0) return { applied: 0, overkill: 0, killed: false };

    const pool = target.shield + target.health;
    const applied = Math.min(modified, pool);
    const overkill = modified - applied;

    const absorbed = Math.min(target.shield, modified);
    target.shield -= absorbed;
    target.health = Math.max(0, target.health - (modified - absorbed));
    if (source) source.damageDealt += applied;

    this.log({
      type: 'damage',
      actorUid: source?.uid,
      targetUid: target.uid,
      amount: applied,
      message: `${target.card.displayName} takes ${applied} (${target.health} left).`,
    });

    let killed = false;
    if (target.health <= 0) {
      killed = !this.tryPreventDeath(target);
      if (killed) this.retire(target, 'death');
    }

    if (!killed && target.alive) {
      this.eachAbility(target, (hooks, ability) => {
        if (hooks.afterDamaged) hooks.afterDamaged(this, target, ability, source, kind, applied);
      });
    }

    return { applied, overkill, killed };
  }

  private tryPreventDeath(target: DuelUnit): boolean {
    let prevented = false;
    this.eachAbility(target, (hooks, ability) => {
      if (prevented || !hooks.preventDeath) return;
      if (hooks.preventDeath(this, target, ability)) prevented = true;
    });
    return prevented && target.health > 0;
  }

  /** Removes a unit from the board and sends its card to the discard pile. */
  private retire(unit: DuelUnit, why: 'death' | 'spent'): void {
    if (!unit.alive) return;
    unit.alive = false;
    unit.shield = 0;
    unit.poison = 0;

    const owner = this.playerState(unit.ownerId);
    const lane = owner.lanes.findIndex((slot) => slot?.uid === unit.uid);
    if (lane !== -1) owner.lanes[lane] = null;
    owner.discard.push({ kind: 'creature', instanceId: unit.card.instance.instanceId });

    this.log({
      type: why === 'death' ? 'death' : 'spent',
      targetUid: unit.uid,
      message:
        why === 'death'
          ? `${unit.card.displayName} is destroyed.`
          : `${unit.card.displayName} is spent and returns to the discard pile.`,
    });
  }

  // ------------------------------------------------------------------- turns

  private beginTurn(): void {
    this.turn += 1;
    const player = this.active;

    this.log({
      type: 'turn-start',
      playerId: player.id,
      message: `— ${player.name}, turn ${this.turn} —`,
    });

    for (const unit of this.unitsOf(player.id)) {
      this.eachAbility(unit, (hooks, ability) => {
        if (hooks.onTurnStart) hooks.onTurnStart(this, unit, ability);
      });
    }

    for (const unit of this.unitsOf(player.id)) {
      if (!unit.alive || unit.poison <= 0) continue;
      const stacks = unit.poison;
      this.log({
        type: 'ability',
        targetUid: unit.uid,
        amount: stacks,
        message: `${unit.card.displayName} suffers ${stacks} poison.`,
      });
      this.dealDamage(unit, stacks, 'poison', null);
      unit.poison = Math.max(0, stacks - 1);
    }

    player.energy = Math.min(
      this.config.maxEnergy,
      this.config.startingEnergy + (this.round - 1) * this.config.energyPerRound,
    );

    const missing = this.config.handSize - player.hand.length;
    if (missing > 0) this.drawCards(player.id, missing);

    this.checkEnd();
  }

  private endTurn(): void {
    this.activeIndex = 1 - this.activeIndex;
    if (this.turn >= this.config.maxTurns) {
      this.finish('turn-limit');
      return;
    }
    this.beginTurn();
  }

  private checkEnd(): void {
    if (this.ended) return;
    const dead = this.players.find((player) => player.nexusHealth <= 0);
    if (dead) this.finish('nexus-destroyed');
  }

  private finish(reason: DuelEndReason): void {
    if (this.ended) return;
    const [a, b] = this.players;

    let winner: string | null;
    if (a.nexusHealth <= 0 && b.nexusHealth <= 0) winner = null;
    else if (a.nexusHealth <= 0) winner = b.id;
    else if (b.nexusHealth <= 0) winner = a.id;
    else if (a.nexusHealth !== b.nexusHealth) {
      winner = a.nexusHealth > b.nexusHealth ? a.id : b.id;
    } else winner = null;

    this.ended = {
      winner,
      loser: winner === null ? null : this.opponentOf(winner),
      reason,
      turns: this.turn,
      nexus: { [a.id]: a.nexusHealth, [b.id]: b.nexusHealth },
    };

    this.log({
      type: 'duel-end',
      playerId: winner ?? undefined,
      message:
        winner === null
          ? `A draw at ${a.nexusHealth} to ${b.nexusHealth}.`
          : `${this.playerState(winner).name} wins, ${a.nexusHealth} to ${b.nexusHealth}.`,
    });
  }

  get result(): DuelResult | null {
    return this.ended;
  }

  get isOver(): boolean {
    return this.ended !== null;
  }

  // ----------------------------------------------------------- legal actions

  private handEntry(player: PlayerState, id: string): DeckEntry | null {
    return (
      player.hand.find(
        (entry) =>
          (entry.kind === 'creature' && entry.instanceId === id) ||
          (entry.kind === 'effect' && entry.effectId === id),
      ) ?? null
    );
  }

  costOf(player: PlayerState, entry: DeckEntry): number {
    if (entry.kind === 'effect') return this.effects.get(entry.effectId)?.cost ?? 0;
    return player.creatures.get(entry.instanceId)?.deployCost ?? 0;
  }

  /** Damage `attacker` would do to `target` right now. */
  projectedDamage(attacker: DuelUnit, target: DuelUnit): number {
    let raw = attacker.might;
    this.eachAbility(attacker, (hooks, ability) => {
      if (hooks.outgoingDamage) raw = hooks.outgoingDamage(this, attacker, ability, target, raw);
    });
    const guard = this.isPiercing(attacker) ? 0 : this.effectiveGuard(target);
    return Math.max(1, Math.round(raw) - guard);
  }

  canAttack(unit: DuelUnit): boolean {
    return (
      unit.alive &&
      unit.ownerId === this.active.id &&
      unit.stamina > 0 &&
      unit.playedOnTurn < this.turn &&
      unit.attackedOnTurn < this.turn
    );
  }

  /** True when the lane facing this attacker is empty, opening the nexus. */
  laneIsOpen(unit: DuelUnit): boolean {
    const enemy = this.playerState(this.opponentOf(unit.ownerId));
    return enemy.lanes[unit.lane] == null;
  }

  legalActions(): DuelAction[] {
    if (this.isOver) return [];
    const player = this.active;
    const actions: DuelAction[] = [{ type: 'end-turn' }];

    for (const entry of player.hand) {
      const cost = this.costOf(player, entry);
      if (cost > player.energy) continue;

      if (entry.kind === 'creature') {
        player.lanes.forEach((slot, lane) => {
          if (slot === null) {
            actions.push({ type: 'play-creature', instanceId: entry.instanceId, lane });
          }
        });
      } else {
        const effect = this.effects.get(entry.effectId);
        if (!effect) continue;
        if (effect.target === 'none') {
          actions.push({ type: 'play-effect', effectId: entry.effectId });
        } else {
          for (const unit of this.effectTargets(player.id, effect.target)) {
            actions.push({
              type: 'play-effect',
              effectId: entry.effectId,
              targetUid: unit.uid,
            });
          }
        }
      }
    }

    for (const unit of this.unitsOf(player.id)) {
      if (!this.canAttack(unit)) continue;
      for (const enemy of this.unitsOf(this.opponentOf(player.id))) {
        if (enemy.alive) actions.push({ type: 'attack', attackerUid: unit.uid, targetUid: enemy.uid });
      }
      if (this.laneIsOpen(unit)) {
        actions.push({ type: 'attack', attackerUid: unit.uid, targetUid: NEXUS_TARGET });
      }
    }

    return actions;
  }

  effectTargets(casterId: string, target: string): readonly DuelUnit[] {
    const mine = this.unitsOf(casterId).filter((unit) => unit.alive);
    const theirs = this.unitsOf(this.opponentOf(casterId)).filter((unit) => unit.alive);
    if (target === 'ally') return mine;
    if (target === 'enemy') return theirs;
    if (target === 'any') return [...mine, ...theirs];
    return [];
  }

  /** Every attack the active player could make, with its projected damage. */
  attackOptions(): readonly AttackOption[] {
    const options: AttackOption[] = [];
    for (const action of this.legalActions()) {
      if (action.type !== 'attack') continue;
      const attacker = this.findUnit(action.attackerUid);
      if (!attacker) continue;
      if (action.targetUid === NEXUS_TARGET) {
        options.push({
          attackerUid: attacker.uid,
          targetUid: NEXUS_TARGET,
          lethal: false,
          damage: attacker.might,
        });
        continue;
      }
      const target = this.findUnit(action.targetUid);
      if (!target) continue;
      const damage = this.projectedDamage(attacker, target);
      options.push({
        attackerUid: attacker.uid,
        targetUid: target.uid,
        damage,
        lethal: damage >= target.health + target.shield,
      });
    }
    return options;
  }

  // ------------------------------------------------------------------ actions

  /** Applies an action and returns the events it produced. */
  apply(action: DuelAction): readonly DuelEvent[] {
    this.drain();
    if (this.isOver) return [];

    switch (action.type) {
      case 'play-creature':
        this.playCreature(action.instanceId, action.lane);
        break;
      case 'play-effect':
        this.playEffect(action.effectId, action.targetUid);
        break;
      case 'attack':
        this.attack(action.attackerUid, action.targetUid);
        break;
      case 'end-turn':
        this.endTurn();
        break;
    }

    this.checkEnd();
    return this.drain();
  }

  private playCreature(instanceId: string, lane: number): void {
    const player = this.active;
    const entry = this.handEntry(player, instanceId);
    if (!entry || entry.kind !== 'creature') return;
    if (lane < 0 || lane >= player.lanes.length || player.lanes[lane] != null) return;

    const card = player.creatures.get(instanceId);
    if (!card || card.deployCost > player.energy) return;

    player.hand.splice(player.hand.indexOf(entry), 1);
    player.energy -= card.deployCost;

    this.uidSeed += 1;
    const maxStamina = staminaFor(card.definition.rarity, card.level);
    const unit: DuelUnit = {
      uid: `${player.id}:${instanceId}:${this.uidSeed}`,
      ownerId: player.id,
      card,
      lane,
      health: card.stats.vitality + card.tier.healthBonus,
      maxHealth: card.stats.vitality + card.tier.healthBonus,
      shield: 0,
      might: card.stats.might + card.tier.attackBonus,
      speed: card.stats.speed,
      guard: card.stats.guard,
      poison: 0,
      stamina: maxStamina,
      maxStamina,
      alive: true,
      playedOnTurn: this.turn,
      attackedOnTurn: -1,
      rebirthUsed: false,
      aegisUsed: false,
      kills: 0,
      damageDealt: 0,
      abilities: card.abilities,
    };

    player.lanes[lane] = unit;
    this.units.push(unit);

    this.log({
      type: 'play-creature',
      playerId: player.id,
      actorUid: unit.uid,
      amount: card.deployCost,
      message: `${player.name} plays ${card.displayName} (${unit.might}/${unit.health}, ${maxStamina} stamina) into lane ${lane + 1}.`,
    });

    this.eachAbility(unit, (hooks, ability) => {
      if (hooks.onPlay) hooks.onPlay(this, unit, ability);
    });
  }

  private playEffect(effectId: string, targetUid: string | undefined): void {
    const player = this.active;
    const entry = this.handEntry(player, effectId);
    if (!entry || entry.kind !== 'effect') return;

    const effect = this.effects.get(effectId);
    if (!effect || effect.cost > player.energy) return;

    const target = targetUid ? this.findUnit(targetUid) : null;
    if (effect.target !== 'none' && target === null) return;
    if (effect.target !== 'none' && target !== null) {
      const legal = this.effectTargets(player.id, effect.target).some(
        (unit) => unit.uid === target.uid,
      );
      if (!legal) return;
    }

    player.hand.splice(player.hand.indexOf(entry), 1);
    player.energy -= effect.cost;
    player.discard.push(entry);

    const handler = effectHandler(effectId);
    if (handler) handler({ api: this, casterId: player.id, effect, target });
  }

  private attack(attackerUid: string, targetUid: string): void {
    const attacker = this.findUnit(attackerUid);
    if (!attacker || !this.canAttack(attacker)) return;

    if (targetUid === NEXUS_TARGET) {
      if (!this.laneIsOpen(attacker)) return;
      attacker.attackedOnTurn = this.turn;
      this.spendStamina(attacker);
      this.log({
        type: 'attack',
        actorUid: attacker.uid,
        amount: attacker.might,
        message: `${attacker.card.displayName} strikes at the nexus through an open lane.`,
      });
      attacker.damageDealt += attacker.might;
      this.damageNexus(this.opponentOf(attacker.ownerId), attacker.might);
      return;
    }

    const target = this.findUnit(targetUid);
    if (!target || target.ownerId === attacker.ownerId) return;

    attacker.attackedOnTurn = this.turn;

    const multipliers: number[] = [1];
    this.eachAbility(attacker, (hooks, ability) => {
      if (hooks.extraSwings) multipliers.push(...hooks.extraSwings(ability));
    });

    for (const multiplier of multipliers) {
      if (!attacker.alive || !target.alive) break;
      this.resolveSwing(attacker, target, multiplier);
    }

    this.spendStamina(attacker);
  }

  private spendStamina(unit: DuelUnit): void {
    if (!unit.alive) return;
    unit.stamina -= 1;
    this.log({
      type: 'stamina',
      actorUid: unit.uid,
      amount: unit.stamina,
      message: `${unit.card.displayName} has ${unit.stamina} stamina left.`,
    });
    if (unit.stamina <= 0) this.retire(unit, 'spent');
  }

  private resolveSwing(attacker: DuelUnit, target: DuelUnit, multiplier: number): void {
    const gap = this.effectiveSpeed(target) - this.effectiveSpeed(attacker);
    const dodge = Math.min(MAX_DODGE_PERCENT, Math.max(0, gap * DODGE_PER_SPEED)) / 100;
    if (dodge > 0 && this.active.rng.chance(dodge)) {
      this.log({
        type: 'dodge',
        actorUid: attacker.uid,
        targetUid: target.uid,
        message: `${target.card.displayName} slips the blow.`,
      });
      return;
    }

    let raw = attacker.might * multiplier;
    this.eachAbility(attacker, (hooks, ability) => {
      if (hooks.outgoingDamage) raw = hooks.outgoingDamage(this, attacker, ability, target, raw);
    });
    const guard = this.isPiercing(attacker) ? 0 : this.effectiveGuard(target);
    const swing = Math.max(1, Math.round(raw) - guard);

    this.log({
      type: 'attack',
      actorUid: attacker.uid,
      targetUid: target.uid,
      amount: swing,
      message: `${attacker.card.displayName} hits ${target.card.displayName} for ${swing}.`,
    });

    const outcome = this.dealDamage(target, swing, 'attack', attacker);

    this.eachAbility(attacker, (hooks, ability) => {
      if (hooks.afterAttack) {
        hooks.afterAttack(this, attacker, ability, target, outcome.applied, outcome.overkill);
      }
    });

    if (outcome.killed) {
      attacker.kills += 1;
      this.eachAbility(attacker, (hooks, ability) => {
        if (hooks.onKill) hooks.onKill(this, attacker, ability, target);
      });
    }
  }

  // ---------------------------------------------------------------- snapshot

  snapshot(): DuelSnapshot {
    const [a, b] = this.players;
    return {
      turn: this.turn,
      round: this.round,
      activePlayerId: this.active.id,
      players: [this.snapshotPlayer(a), this.snapshotPlayer(b)],
      over: this.isOver,
    };
  }

  private snapshotPlayer(player: PlayerState): DuelPlayerSnapshot {
    const isActive = player.id === this.active.id;
    const boardFull = player.lanes.every((lane) => lane !== null);

    const hand: HandSnapshot[] = player.hand.map((entry) => {
      const cost = this.costOf(player, entry);
      const affordable = cost <= player.energy;

      if (entry.kind === 'creature') {
        const card = player.creatures.get(entry.instanceId) as ResolvedCard;
        const playable = isActive && affordable && !boardFull && !this.isOver;
        return {
          kind: 'creature',
          id: entry.instanceId,
          name: card.displayName,
          cost,
          playable,
          level: card.level,
          rarity: card.definition.rarity,
          rarityLabel: card.rarity.label,
          tier: card.powerTier,
          tierLabel: card.tier.label,
          might: card.stats.might + card.tier.attackBonus,
          vitality: card.stats.vitality + card.tier.healthBonus,
          speed: card.stats.speed,
          guard: card.stats.guard,
          stamina: staminaFor(card.definition.rarity, card.level),
          art: artKey(card.definition.id),
          abilities: card.abilities.map((ability) => ({
            name: ability.name,
            description: abilityText(ability),
          })),
          blocked: !isActive
            ? 'Not your turn'
            : boardFull
              ? 'No empty lane'
              : !affordable
                ? `Needs ${cost} energy`
                : '',
        };
      }

      const effect = this.effects.get(entry.effectId) as EffectDefinition;
      const hasTarget =
        effect.target === 'none' || this.effectTargets(player.id, effect.target).length > 0;
      return {
        kind: 'effect',
        id: entry.effectId,
        name: effect.name,
        cost,
        playable: isActive && affordable && hasTarget && !this.isOver,
        rarity: effect.rarity,
        rarityLabel: effect.rarity.charAt(0).toUpperCase() + effect.rarity.slice(1),
        target: effect.target,
        text: effectText(effect),
        art: artKey(effect.id),
        blocked: !isActive
          ? 'Not your turn'
          : !affordable
            ? `Needs ${cost} energy`
            : !hasTarget
              ? 'No legal target'
              : '',
      };
    });

    return {
      id: player.id,
      name: player.name,
      nexusHealth: player.nexusHealth,
      maxNexusHealth: this.config.nexusHealth,
      energy: player.energy,
      drawCount: player.draw.length,
      discardCount: player.discard.length,
      hand,
      lanes: player.lanes.map((unit) => (unit ? this.snapshotUnit(unit) : null)),
    };
  }

  private snapshotUnit(unit: DuelUnit): UnitSnapshot {
    return {
      uid: unit.uid,
      ownerId: unit.ownerId,
      name: unit.card.displayName,
      lane: unit.lane,
      health: unit.health,
      maxHealth: unit.maxHealth,
      shield: unit.shield,
      might: unit.might,
      guard: this.effectiveGuard(unit),
      speed: this.effectiveSpeed(unit),
      poison: unit.poison,
      stamina: unit.stamina,
      maxStamina: unit.maxStamina,
      alive: unit.alive,
      canAttack: this.canAttack(unit),
      resting: unit.playedOnTurn >= this.turn,
      level: unit.card.level,
      rarity: unit.card.definition.rarity,
      rarityLabel: unit.card.rarity.label,
      tier: unit.card.powerTier,
      tierLabel: unit.card.tier.label,
      art: artKey(unit.card.definition.id),
      abilities: unit.abilities.map((ability) => ({
        name: ability.name,
        description: abilityText(ability),
      })),
    };
  }
}

export function createDuel(
  setups: readonly [DuelPlayerSetup, DuelPlayerSetup],
  library: CardLibrary,
  effects: ReadonlyMap<string, EffectDefinition>,
  instances: readonly CardInstance[],
  config: Partial<DuelConfig> = {},
): Duel {
  return new Duel(setups, library, effects, instances, config);
}
