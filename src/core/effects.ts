/**
 * Effect cards.
 *
 * Unlike creatures, effects are not owned copies that level — they are
 * consumables. A deck lists them by id, they resolve once, and they go to the
 * discard pile. That keeps the whole levelling system (instances, growth
 * points, power tiers) pointed at creatures, where it belongs.
 */

import type { Rarity } from './rarity.ts';
import type { CreatureFamily } from './cardDefinition.ts';

/** What an effect needs picked before it can resolve. */
export const EFFECT_TARGETS = ['none', 'ally', 'enemy', 'any'] as const;

export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export interface EffectDefinition {
  readonly id: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly family: CreatureFamily;
  /** Energy to play. Effects have no power tier, so this is printed. */
  readonly cost: number;
  readonly target: EffectTarget;
  /** Rules text, with {param} placeholders filled from `params`. */
  readonly text: string;
  readonly params: Readonly<Record<string, number>>;
  readonly flavor: string;
}

export function defineEffect(
  definition: Omit<EffectDefinition, 'params'> & { params?: Record<string, number> },
): EffectDefinition {
  return { ...definition, params: Object.freeze({ ...(definition.params ?? {}) }) };
}

export function effectParam(effect: EffectDefinition, key: string, fallback = 0): number {
  return effect.params[key] ?? fallback;
}

/** Rules text with its numbers filled in. */
export function effectText(effect: EffectDefinition): string {
  return effect.text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = effect.params[key];
    return value === undefined ? match : String(value);
  });
}
