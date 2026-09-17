/**
 * A player's collection: every copy they own, and the operations that change
 * one. This is the only place a `CardInstance` is mutated between battles.
 */

import type { CardInstance, CreateInstanceOptions, ResolvedCard } from '../core/cardInstance.ts';
import { createCardInstance, resolveCard } from '../core/cardInstance.ts';
import type { GrantXpResult } from '../core/leveling.ts';
import { allocate, autoAllocate, grantXp, respec } from '../core/leveling.ts';
import type { CardLibrary } from '../core/library.ts';
import type { Rarity } from '../core/rarity.ts';
import type { StatKey } from '../core/stats.ts';

export class Collection {
  readonly library: CardLibrary;
  private readonly instances = new Map<string, CardInstance>();

  constructor(library: CardLibrary) {
    this.library = library;
  }

  /** Adds a fresh copy of a printed card. Every copy starts identical. */
  add(definitionId: string, options: CreateInstanceOptions = {}): CardInstance {
    const definition = this.library.getCard(definitionId);
    const instance = createCardInstance(definition, options);
    this.instances.set(instance.instanceId, instance);
    return instance;
  }

  addMany(definitionId: string, count: number): CardInstance[] {
    return Array.from({ length: count }, () => this.add(definitionId));
  }

  has(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  get(instanceId: string): CardInstance {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`No card instance "${instanceId}" in this collection.`);
    return instance;
  }

  all(): readonly CardInstance[] {
    return [...this.instances.values()];
  }

  resolve(instanceId: string): ResolvedCard {
    return resolveCard(this.get(instanceId), this.library);
  }

  resolveAll(): readonly ResolvedCard[] {
    return this.all().map((instance) => resolveCard(instance, this.library));
  }

  byRarity(rarity: Rarity): readonly CardInstance[] {
    return this.all().filter(
      (instance) => this.library.getCard(instance.definitionId).rarity === rarity,
    );
  }

  copiesOf(definitionId: string): readonly CardInstance[] {
    return this.all().filter((instance) => instance.definitionId === definitionId);
  }

  private replace(instance: CardInstance): CardInstance {
    this.instances.set(instance.instanceId, instance);
    return instance;
  }

  /** Awards XP, levelling the card up as far as the XP goes. */
  grantXp(instanceId: string, amount: number): GrantXpResult {
    const result = grantXp(this.get(instanceId), amount, this.library);
    this.replace(result.instance);
    return result;
  }

  /** Spends growth points. Throws if the card cannot afford the allocation. */
  allocate(instanceId: string, delta: Partial<Record<StatKey, number>>): CardInstance {
    const result = allocate(this.get(instanceId), delta, this.library);
    if (!result.ok) throw new Error(result.error.message);
    return this.replace(result.instance);
  }

  /** Spends every unspent point across `focus`, round-robin. */
  autoAllocate(instanceId: string, focus: readonly StatKey[]): CardInstance {
    return this.replace(autoAllocate(this.get(instanceId), focus, this.library));
  }

  /** Returns every point so the card can be rebuilt from scratch. */
  respec(instanceId: string): CardInstance {
    return this.replace(respec(this.get(instanceId)));
  }

  rename(instanceId: string, nickname: string | null): CardInstance {
    return this.replace({ ...this.get(instanceId), nickname });
  }

  recordBattle(instanceId: string): CardInstance {
    const instance = this.get(instanceId);
    return this.replace({ ...instance, battlesFought: instance.battlesFought + 1 });
  }

  /** Instances for a deck list, in deck order. */
  deckInstances(instanceIds: readonly string[]): CardInstance[] {
    return instanceIds.map((id) => this.get(id));
  }
}
