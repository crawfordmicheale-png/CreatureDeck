/**
 * The battle engine.
 *
 * Two players, a nexus each, a board of slots, and one deterministic round
 * loop. Given the same decks, controllers and seed, `runBattle` always
 * produces the same log — which is what makes balance work and regression
 * tests possible.
 *
 * Round structure:
 *   1. Upkeep     — Regrowth and friends tick, then poison bites.
 *   2. Draw       — one card, or the opening hand on round 1; fatigue if empty.
 *   3. Deployment — each controller spends its energy.
 *   4. Combat     — every living creature acts once, fastest first.
 *   5. Cleanup    — the dead leave the board, win conditions are checked.
 */

import type { AbilityDefinition } from '../core/abilities.ts';
import type { CardInstance, ResolvedCard } from '../core/cardInstance.ts';
import { resolveCard } from '../core/cardInstance.ts';
import type { CardLibrary } from '../core/library.ts';
import type { Rng } from '../core/rng.ts';
import { createRng } from '../core/rng.ts';
import type { AbilityCtx, AbilityHooks } from './abilityHandlers.ts';
import { hooksFor } from './abilityHandlers.ts';
import type {
  BattleApi,
  BattleConfig,
  BattleEndReason,
  BattleEvent,
  BattleResult,
  BattleSnapshot,
  BattleStep,
  CardBattleStats,
  Combatant,
  CombatantSnapshot,
  Controller,
  ControllerView,
  DamageKind,
  DeploymentReply,
  PlayerBattleSummary,
  PlayerSnapshot,
  ResolvedCardSnapshot,
} from './types.ts';
import { DEFAULT_BATTLE_CONFIG } from './types.ts';

export interface BattlePlayerSetup {
  readonly id: string;
  readonly name: string;
  readonly deck: readonly CardInstance[];
  readonly controller: Controller;
}

/** Maximum dodge chance, as a percentage, however large the speed gap. */
const MAX_DODGE_PERCENT = 25;
/** Dodge percentage granted per point of speed advantage. */
const DODGE_PER_SPEED = 1.5;

interface DamageOutcome {
  /** Damage after incoming modifiers, before health/shield clamping. */
  readonly modified: number;
  /** Damage actually removed from shield plus health. */
  readonly applied: number;
  /** Damage beyond what the target had left. */
  readonly overkill: number;
  readonly killed: boolean;
}

interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly controller: Controller;
  readonly cards: Map<string, ResolvedCard>;
  readonly board: (Combatant | null)[];
  drawPile: string[];
  hand: string[];
  nexusHealth: number;
  energy: number;
  fatigue: number;
  rng: Rng;
}

class Battle implements BattleApi {
  readonly config: BattleConfig;
  readonly library: CardLibrary;
  readonly rng: Rng;
  readonly players: [PlayerState, PlayerState];
  readonly events: BattleEvent[] = [];
  readonly combatants: Combatant[] = [];
  round = 0;
  /** How much of `events` a front-end has already been handed. */
  private drained = 0;

  constructor(
    setups: readonly [BattlePlayerSetup, BattlePlayerSetup],
    library: CardLibrary,
    config: BattleConfig,
  ) {
    this.config = config;
    this.library = library;
    this.rng = createRng(config.seed);
    this.players = [
      this.createPlayer(setups[0], this.rng.fork(1)),
      this.createPlayer(setups[1], this.rng.fork(2)),
    ];
  }

  private createPlayer(setup: BattlePlayerSetup, rng: Rng): PlayerState {
    const cards = new Map<string, ResolvedCard>();
    for (const instance of setup.deck) {
      if (cards.has(instance.instanceId)) {
        throw new Error(
          `Deck for "${setup.id}" contains the instance "${instance.instanceId}" twice.`,
        );
      }
      cards.set(instance.instanceId, resolveCard(instance, this.library));
    }
    return {
      id: setup.id,
      name: setup.name,
      controller: setup.controller,
      cards,
      board: new Array<Combatant | null>(this.config.boardSlots).fill(null),
      drawPile: rng.shuffle([...cards.keys()]),
      hand: [],
      nexusHealth: this.config.nexusHealth,
      energy: 0,
      fatigue: 0,
      rng,
    };
  }

  // ------------------------------------------------------------- BattleApi

  log(event: Omit<BattleEvent, 'round'>): void {
    this.events.push({ round: this.round, ...event });
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

  private boardOf(playerId: string): readonly Combatant[] {
    return this.playerState(playerId).board.filter((slot): slot is Combatant => slot !== null);
  }

  alliesOf(combatant: Combatant): readonly Combatant[] {
    return this.boardOf(combatant.ownerId);
  }

  enemiesOf(combatant: Combatant): readonly Combatant[] {
    return this.boardOf(this.opponentOf(combatant.ownerId));
  }

  livingEnemiesOf(combatant: Combatant): readonly Combatant[] {
    return this.enemiesOf(combatant)
      .filter((enemy) => enemy.alive)
      .sort((a, b) => a.slot - b.slot);
  }

  heal(target: Combatant, amount: number): number {
    if (!target.alive || amount <= 0) return 0;
    const healed = Math.min(amount, target.maxHealth - target.health);
    target.health += healed;
    return healed;
  }

  grantShield(target: Combatant, amount: number): void {
    if (!target.alive || amount <= 0) return;
    target.shield += amount;
  }

  buffMight(target: Combatant, amount: number): void {
    target.might = Math.max(0, target.might + amount);
  }

  addPoison(target: Combatant, stacks: number): void {
    if (!target.alive || stacks <= 0) return;
    target.poison += stacks;
  }

  damageNexus(playerId: string, amount: number): void {
    if (amount <= 0) return;
    const player = this.playerState(playerId);
    player.nexusHealth = Math.max(0, player.nexusHealth - amount);
    this.log({
      type: 'nexus-damage',
      playerId,
      amount,
      message: `${player.name}'s nexus takes ${amount} damage (${player.nexusHealth} left).`,
    });
  }

  damage(target: Combatant, amount: number, kind: DamageKind, source: Combatant | null): number {
    return this.dealDamage(target, amount, kind, source).applied;
  }

  // -------------------------------------------------------- ability plumbing

  private ctx(self: Combatant, ability: AbilityDefinition): AbilityCtx {
    return { api: this, self, ability };
  }

  private eachAbility(
    combatant: Combatant,
    visit: (hooks: AbilityHooks, ctx: AbilityCtx) => void,
  ): void {
    for (const ability of combatant.abilities) {
      const hooks = hooksFor(ability.id);
      if (hooks) visit(hooks, this.ctx(combatant, ability));
    }
  }

  private effectiveSpeed(combatant: Combatant): number {
    let speed = combatant.speed;
    this.eachAbility(combatant, (hooks, ctx) => {
      if (hooks.speedBonus) speed += hooks.speedBonus(ctx);
    });
    return speed;
  }

  private effectiveGuard(combatant: Combatant): number {
    let guard = combatant.guard;
    for (const ally of this.alliesOf(combatant)) {
      if (!ally.alive || ally.uid === combatant.uid) continue;
      this.eachAbility(ally, (hooks, ctx) => {
        if (hooks.allyGuardBonus) guard += hooks.allyGuardBonus(ctx);
      });
    }
    return guard;
  }

  // ------------------------------------------------------------- damage core

  private dealDamage(
    target: Combatant,
    amount: number,
    kind: DamageKind,
    source: Combatant | null,
  ): DamageOutcome {
    if (!target.alive) return { modified: 0, applied: 0, overkill: 0, killed: false };

    let modified = amount;
    this.eachAbility(target, (hooks, ctx) => {
      if (hooks.incomingDamage) modified = hooks.incomingDamage(ctx, source, kind, modified);
    });
    modified = Math.max(0, Math.round(modified));

    if (modified === 0) return { modified: 0, applied: 0, overkill: 0, killed: false };

    const pool = target.shield + target.health;
    const applied = Math.min(modified, pool);
    const overkill = modified - applied;

    const absorbed = Math.min(target.shield, modified);
    target.shield -= absorbed;
    target.health = Math.max(0, target.health - (modified - absorbed));
    target.damageTaken += applied;
    if (source) source.damageDealt += applied;

    this.log({
      type: 'damage',
      actorUid: source?.uid,
      targetUid: target.uid,
      amount: applied,
      message: `${target.card.displayName} takes ${applied} ${kind} damage (${target.health} health left).`,
    });

    let killed = false;
    if (target.health <= 0) {
      killed = !this.tryPreventDeath(target);
      if (killed) {
        target.alive = false;
        target.shield = 0;
        target.poison = 0;
        this.log({
          type: 'death',
          actorUid: source?.uid,
          targetUid: target.uid,
          message: `${target.card.displayName} is destroyed.`,
        });
      }
    }

    if (!killed && target.alive) {
      this.eachAbility(target, (hooks, ctx) => {
        if (hooks.afterDamaged) hooks.afterDamaged(ctx, source, kind, applied);
      });
    }

    return { modified, applied, overkill, killed };
  }

  private tryPreventDeath(target: Combatant): boolean {
    let prevented = false;
    this.eachAbility(target, (hooks, ctx) => {
      if (prevented || !hooks.preventDeath) return;
      if (hooks.preventDeath(ctx)) prevented = true;
    });
    return prevented && target.health > 0;
  }

  // ------------------------------------------------------------------ phases

  private upkeep(): void {
    for (const combatant of this.livingInSpeedOrder()) {
      this.eachAbility(combatant, (hooks, ctx) => {
        if (hooks.onStartOfRound) hooks.onStartOfRound(ctx);
      });
    }
    for (const combatant of this.livingInSpeedOrder()) {
      if (combatant.poison <= 0) continue;
      const stacks = combatant.poison;
      this.dealDamage(combatant, stacks, 'poison', null);
      combatant.poison = Math.max(0, stacks - 1);
    }
  }

  private draw(player: PlayerState, count: number): void {
    for (let i = 0; i < count; i += 1) {
      if (player.drawPile.length === 0) {
        player.fatigue += 1;
        this.log({
          type: 'fatigue',
          playerId: player.id,
          amount: player.fatigue,
          message: `${player.name} has no cards left and suffers ${player.fatigue} fatigue.`,
        });
        this.damageNexus(player.id, player.fatigue);
        continue;
      }
      const instanceId = player.drawPile.shift() as string;
      if (player.hand.length >= this.config.maxHandSize) {
        this.log({
          type: 'draw',
          playerId: player.id,
          message: `${player.name}'s hand is full; ${this.cardName(player, instanceId)} is discarded.`,
        });
        continue;
      }
      player.hand.push(instanceId);
      this.log({
        type: 'draw',
        playerId: player.id,
        message: `${player.name} draws ${this.cardName(player, instanceId)}.`,
      });
    }
  }

  private cardName(player: PlayerState, instanceId: string): string {
    return player.cards.get(instanceId)?.displayName ?? instanceId;
  }

  private freeSlot(player: PlayerState): number {
    return player.board.findIndex((slot) => slot === null);
  }

  /** Energy is granted fresh each round; nothing carries over. */
  private grantEnergy(player: PlayerState): void {
    player.energy = Math.min(
      this.config.maxEnergy,
      this.config.startingEnergy + (this.round - 1) * this.config.energyPerRound,
    );
  }

  private viewFor(player: PlayerState): ControllerView {
    const opponent = this.playerState(this.opponentOf(player.id));
    return {
      round: this.round,
      energy: player.energy,
      freeSlots: player.board.filter((slot) => slot === null).length,
      hand: this.handOf(player),
      board: this.boardOf(player.id),
      enemyBoard: this.boardOf(opponent.id),
      nexusHealth: player.nexusHealth,
      enemyNexusHealth: opponent.nexusHealth,
      rng: player.rng,
    };
  }

  private handOf(player: PlayerState): ResolvedCard[] {
    return player.hand
      .map((id) => player.cards.get(id))
      .filter((card): card is ResolvedCard => card !== undefined);
  }

  /**
   * Puts one card from hand onto the board if it is affordable and there is
   * room. Returns false, without complaint, when it is not — controllers and
   * front-ends alike are allowed to ask for more than they can have.
   */
  private tryDeploy(player: PlayerState, instanceId: string): boolean {
    const handIndex = player.hand.indexOf(instanceId);
    if (handIndex === -1) return false;

    const card = player.cards.get(instanceId);
    if (!card || card.deployCost > player.energy) return false;

    const slot = this.freeSlot(player);
    if (slot === -1) return false;

    player.hand.splice(handIndex, 1);
    player.energy -= card.deployCost;
    this.deploy(player, card, slot);
    return true;
  }

  private deploymentPhase(player: PlayerState): void {
    this.grantEnergy(player);
    for (const instanceId of player.controller.chooseDeployments(this.viewFor(player))) {
      if (this.freeSlot(player) === -1) break;
      this.tryDeploy(player, instanceId);
    }
  }

  /**
   * Deployment driven from outside: yields once per decision and deploys
   * whatever comes back, until the caller replies with null.
   */
  private *interactiveDeployment(
    player: PlayerState,
  ): Generator<BattleStep, void, DeploymentReply> {
    this.grantEnergy(player);

    for (;;) {
      const playable = this.handOf(player).filter(
        (card) => card.deployCost <= player.energy,
      );
      const freeSlots = player.board.filter((slot) => slot === null).length;

      // Nothing affordable, or nowhere to put it: the phase is over on its
      // own. Without this the caller would be asked to decide forever.
      if (playable.length === 0 || freeSlots === 0) return;

      const reply = yield {
        kind: 'deployment',
        playerId: player.id,
        round: this.round,
        energy: player.energy,
        freeSlots,
        playable: playable.map(snapshotCard),
        events: this.drain(),
        snapshot: this.snapshot(),
      };

      if (reply === null || reply === undefined) return;
      this.tryDeploy(player, reply);
    }
  }

  private deploy(player: PlayerState, card: ResolvedCard, slot: number): void {
    const combatant: Combatant = {
      uid: `${player.id}:${card.instance.instanceId}`,
      ownerId: player.id,
      card,
      slot,
      deployedRound: this.round,
      health: card.stats.vitality + card.tier.healthBonus,
      maxHealth: card.stats.vitality + card.tier.healthBonus,
      shield: 0,
      might: card.stats.might + card.tier.attackBonus,
      speed: card.stats.speed,
      guard: card.stats.guard,
      poison: 0,
      alive: true,
      rebirthUsed: false,
      aegisUsed: false,
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      abilities: card.abilities,
    };

    player.board[slot] = combatant;
    this.combatants.push(combatant);

    this.log({
      type: 'deploy',
      playerId: player.id,
      actorUid: combatant.uid,
      amount: card.deployCost,
      message: `${player.name} deploys ${card.displayName} (L${card.level} ${card.rarity.label} · ${card.tier.label}, ${combatant.might}/${combatant.health}) for ${card.deployCost} energy.`,
    });

    this.eachAbility(combatant, (hooks, ctx) => {
      if (hooks.onEnter) hooks.onEnter(ctx);
    });
  }

  private livingInSpeedOrder(): Combatant[] {
    const living = this.combatants.filter((combatant) => combatant.alive);
    return living.sort((a, b) => {
      const speedDelta = this.effectiveSpeed(b) - this.effectiveSpeed(a);
      if (speedDelta !== 0) return speedDelta;
      return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
    });
  }

  private combatPhase(): void {
    for (const attacker of this.livingInSpeedOrder()) {
      if (!attacker.alive) continue;
      if (attacker.deployedRound === this.round) continue;
      if (this.isOver()) return;
      this.takeTurn(attacker);
    }
  }

  private takeTurn(attacker: Combatant): void {
    const multipliers: number[] = [1];
    this.eachAbility(attacker, (hooks, ctx) => {
      if (hooks.extraSwings) multipliers.push(...hooks.extraSwings(ctx));
    });

    for (const multiplier of multipliers) {
      if (!attacker.alive || this.isOver()) return;

      const candidates = this.livingEnemiesOf(attacker);
      if (candidates.length === 0) {
        const damage = Math.max(0, Math.round(attacker.might * multiplier));
        this.log({
          type: 'attack',
          actorUid: attacker.uid,
          amount: damage,
          message: `${attacker.card.displayName} strikes at the undefended nexus.`,
        });
        attacker.damageDealt += damage;
        this.damageNexus(this.opponentOf(attacker.ownerId), damage);
        continue;
      }

      let target: Combatant | null = null;
      this.eachAbility(attacker, (hooks, ctx) => {
        if (target !== null || !hooks.selectTarget) return;
        target = hooks.selectTarget(ctx, candidates);
      });
      const victim: Combatant = target ?? (candidates[0] as Combatant);

      this.resolveSwing(attacker, victim, multiplier);
    }
  }

  private resolveSwing(attacker: Combatant, target: Combatant, multiplier: number): void {
    const speedGap = this.effectiveSpeed(target) - this.effectiveSpeed(attacker);
    const dodgeChance = Math.min(MAX_DODGE_PERCENT, Math.max(0, speedGap * DODGE_PER_SPEED)) / 100;
    if (dodgeChance > 0 && this.rng.chance(dodgeChance)) {
      this.log({
        type: 'dodge',
        actorUid: attacker.uid,
        targetUid: target.uid,
        message: `${target.card.displayName} slips ${attacker.card.displayName}'s blow.`,
      });
      return;
    }

    let raw = attacker.might * multiplier;
    this.eachAbility(attacker, (hooks, ctx) => {
      if (hooks.outgoingDamage) raw = hooks.outgoingDamage(ctx, target, raw);
    });

    const swing = Math.max(1, Math.round(raw) - this.effectiveGuard(target));
    this.log({
      type: 'attack',
      actorUid: attacker.uid,
      targetUid: target.uid,
      amount: swing,
      message: `${attacker.card.displayName} attacks ${target.card.displayName} for ${swing}.`,
    });

    const outcome = this.dealDamage(target, swing, 'attack', attacker);

    this.eachAbility(attacker, (hooks, ctx) => {
      if (hooks.afterAttack) hooks.afterAttack(ctx, target, outcome.applied, outcome.overkill);
    });

    if (outcome.killed) {
      attacker.kills += 1;
      this.eachAbility(attacker, (hooks, ctx) => {
        if (hooks.onKill) hooks.onKill(ctx, target);
      });
    }
  }

  private cleanup(): void {
    for (const player of this.players) {
      for (let i = 0; i < player.board.length; i += 1) {
        const combatant = player.board[i];
        if (combatant && !combatant.alive) player.board[i] = null;
      }
    }
  }

  private isOver(): boolean {
    return this.players.some((player) => player.nexusHealth <= 0);
  }

  /** Remaining board presence, used only to break a round-limit tie. */
  private boardStrength(playerId: string): number {
    return this.boardOf(playerId)
      .filter((combatant) => combatant.alive)
      .reduce((total, combatant) => total + combatant.health + combatant.might, 0);
  }

  /** Total damage this player's creatures dealt, as a last-resort tiebreak. */
  private damageDealt(playerId: string): number {
    return this.combatants
      .filter((combatant) => combatant.ownerId === playerId)
      .reduce((total, combatant) => total + combatant.damageDealt, 0);
  }

  /**
   * Settles a battle that ended level: first on who still holds the board,
   * then on who did more work. Only a dead-even result on both counts is a
   * genuine draw.
   */
  private breakTie(aId: string, bId: string): string | null {
    const byBoard = this.boardStrength(aId) - this.boardStrength(bId);
    if (byBoard !== 0) return byBoard > 0 ? aId : bId;
    const byDamage = this.damageDealt(aId) - this.damageDealt(bId);
    if (byDamage !== 0) return byDamage > 0 ? aId : bId;
    return null;
  }

  // ------------------------------------------------------------- front-ends

  /** Events appended since the last drain, so a front-end can animate them. */
  private drain(): readonly BattleEvent[] {
    const fresh = this.events.slice(this.drained);
    this.drained = this.events.length;
    return fresh;
  }

  snapshot(): BattleSnapshot {
    const [first, second] = this.players;
    return {
      round: this.round,
      players: [this.snapshotPlayer(first), this.snapshotPlayer(second)],
    };
  }

  private snapshotPlayer(player: PlayerState): PlayerSnapshot {
    return {
      id: player.id,
      name: player.name,
      nexusHealth: player.nexusHealth,
      maxNexusHealth: this.config.nexusHealth,
      energy: player.energy,
      drawPileSize: player.drawPile.length,
      hand: this.handOf(player).map(snapshotCard),
      board: player.board.map((slot) => (slot ? this.snapshotCombatant(slot) : null)),
    };
  }

  private snapshotCombatant(combatant: Combatant): CombatantSnapshot {
    return {
      uid: combatant.uid,
      instanceId: combatant.card.instance.instanceId,
      ownerId: combatant.ownerId,
      name: combatant.card.displayName,
      slot: combatant.slot,
      health: combatant.health,
      maxHealth: combatant.maxHealth,
      shield: combatant.shield,
      might: combatant.might,
      speed: this.effectiveSpeed(combatant),
      guard: this.effectiveGuard(combatant),
      poison: combatant.poison,
      alive: combatant.alive,
      justDeployed: combatant.deployedRound === this.round,
      level: combatant.card.level,
      rarity: combatant.card.definition.rarity,
      tier: combatant.card.powerTier,
      tierLabel: combatant.card.tier.label,
      abilities: combatant.abilities.map((ability) => ability.name),
    };
  }

  // -------------------------------------------------------------------- run

  /**
   * The round loop, as a generator.
   *
   * Players named in `interactive` are asked for each deployment through a
   * yielded step instead of through their controller, which is what lets a
   * front-end sit inside the loop without the engine knowing anything about it.
   * `run()` drives this with nobody interactive, so the headless path is the
   * same code.
   */
  *play(
    interactive: ReadonlySet<string> = new Set<string>(),
  ): Generator<BattleStep, BattleResult, DeploymentReply> {
    const [first, second] = this.players;
    this.log({
      type: 'battle-start',
      message: `${first.name} vs ${second.name} — ${this.config.nexusHealth} nexus health, seed ${this.config.seed}.`,
    });

    let reason: BattleEndReason = 'round-limit';

    for (this.round = 1; this.round <= this.config.maxRounds; this.round += 1) {
      this.log({ type: 'round-start', message: `— Round ${this.round} —` });

      this.upkeep();
      this.cleanup();
      if (this.isOver()) {
        reason = 'nexus-destroyed';
        break;
      }

      const drawCount = this.round === 1 ? this.config.openingHand : this.config.drawPerRound;
      for (const player of this.players) this.draw(player, drawCount);
      if (this.isOver()) {
        reason = 'nexus-destroyed';
        break;
      }

      if (interactive.size > 0) {
        yield {
          kind: 'upkeep',
          round: this.round,
          events: this.drain(),
          snapshot: this.snapshot(),
        };
      }

      for (const player of this.players) {
        if (interactive.has(player.id)) yield* this.interactiveDeployment(player);
        else this.deploymentPhase(player);
      }

      this.combatPhase();
      this.cleanup();

      if (interactive.size > 0) {
        yield {
          kind: 'combat',
          round: this.round,
          events: this.drain(),
          snapshot: this.snapshot(),
        };
      }

      if (this.isOver()) {
        reason = 'nexus-destroyed';
        break;
      }
    }

    const rounds = Math.min(this.round, this.config.maxRounds);
    const [a, b] = this.players;
    const aDead = a.nexusHealth <= 0;
    const bDead = b.nexusHealth <= 0;

    let winner: string | null;
    if (aDead && bDead) {
      // Both nexuses fell in the same round. With equal-sized decks this is
      // not a freak result: both players deck out on the same turn and take
      // identical fatigue, so a long game would otherwise always be a draw.
      // Break it the same way a round-limit tie is broken.
      winner = this.breakTie(a.id, b.id);
      reason = 'mutual-destruction';
    } else if (aDead) {
      winner = b.id;
    } else if (bDead) {
      winner = a.id;
    } else if (a.nexusHealth !== b.nexusHealth) {
      winner = a.nexusHealth > b.nexusHealth ? a.id : b.id;
    } else {
      winner = this.breakTie(a.id, b.id);
      if (winner !== null) reason = 'board-tiebreak';
    }

    const loser = winner === null ? null : this.opponentOf(winner);

    this.log({
      type: 'battle-end',
      playerId: winner ?? undefined,
      message:
        winner === null
          ? `Draw after ${rounds} rounds (${a.name} ${a.nexusHealth} vs ${b.name} ${b.nexusHealth}).`
          : `${this.playerState(winner).name} wins after ${rounds} rounds (${a.name} ${a.nexusHealth} vs ${b.name} ${b.nexusHealth})${
              reason === 'board-tiebreak' ? ', on remaining board strength' : ''
            }.`,
    });

    return {
      winner,
      loser,
      reason,
      rounds,
      players: this.players.map((player) => this.summarise(player)),
      log: this.events,
    };
  }

  private summarise(player: PlayerState): PlayerBattleSummary {
    const byInstance = new Map<string, Combatant>();
    for (const combatant of this.combatants) {
      if (combatant.ownerId === player.id) byInstance.set(combatant.card.instance.instanceId, combatant);
    }

    const cards: CardBattleStats[] = [...player.cards.values()].map((card) => {
      const combatant = byInstance.get(card.instance.instanceId);
      return {
        instanceId: card.instance.instanceId,
        name: card.displayName,
        deployed: combatant !== undefined,
        kills: combatant?.kills ?? 0,
        damageDealt: combatant?.damageDealt ?? 0,
        damageTaken: combatant?.damageTaken ?? 0,
        survived: combatant?.alive ?? false,
      };
    });

    return {
      playerId: player.id,
      name: player.name,
      nexusHealth: player.nexusHealth,
      cardsDeployed: byInstance.size,
      cards,
    };
  }
}

/** Plays a battle out with nobody interactive. */
function driveToCompletion(battle: Battle): BattleResult {
  const generator = battle.play();
  let step = generator.next();
  while (!step.done) step = generator.next();
  return step.value;
}

export function runBattle(
  setups: readonly [BattlePlayerSetup, BattlePlayerSetup],
  library: CardLibrary,
  config: Partial<BattleConfig> = {},
): BattleResult {
  return driveToCompletion(new Battle(setups, library, { ...DEFAULT_BATTLE_CONFIG, ...config }));
}

/** Flattens a resolved card into something a front-end can render directly. */
function snapshotCard(card: ResolvedCard): ResolvedCardSnapshot {
  return {
    instanceId: card.instance.instanceId,
    name: card.displayName,
    level: card.level,
    rarity: card.definition.rarity,
    rarityLabel: card.rarity.label,
    tier: card.powerTier,
    tierLabel: card.tier.label,
    deployCost: card.deployCost,
    powerScore: card.powerScore,
    might: card.stats.might,
    vitality: card.stats.vitality,
    speed: card.stats.speed,
    guard: card.stats.guard,
    abilities: card.abilities.map((ability) => ({
      name: ability.name,
      description: ability.description.replace(/\{(\w+)\}/g, (match, key: string) => {
        const value = ability.params[key];
        return value === undefined ? match : String(value);
      }),
    })),
  };
}

/**
 * Starts a battle a front-end drives.
 *
 * Call `.next()` to reach the first pause, then `.next(instanceId)` to deploy
 * a card or `.next(null)` to end that player's deployment. When the generator
 * finishes, its return value is the usual `BattleResult`.
 */
export function playBattle(
  setups: readonly [BattlePlayerSetup, BattlePlayerSetup],
  library: CardLibrary,
  interactivePlayerIds: readonly string[],
  config: Partial<BattleConfig> = {},
): Generator<BattleStep, BattleResult, DeploymentReply> {
  const battle = new Battle(setups, library, { ...DEFAULT_BATTLE_CONFIG, ...config });
  return battle.play(new Set(interactivePlayerIds));
}
