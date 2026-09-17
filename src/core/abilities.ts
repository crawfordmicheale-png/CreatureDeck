/**
 * Ability *metadata*. The battle-time behaviour lives in
 * `src/battle/abilityHandlers.ts`, keyed by the same ids.
 *
 * Keeping the two apart means the card layer can price and describe an ability
 * — including in tooling that never runs a battle — without dragging the whole
 * combat engine along.
 */

export const ABILITY_TRIGGERS = [
  'passive',
  'onDeploy',
  'startOfRound',
  'onAttack',
  'onDamaged',
  'onKill',
  'onDeath',
] as const;

export type AbilityTrigger = (typeof ABILITY_TRIGGERS)[number];

export const ABILITY_TRIGGER_LABELS: Record<AbilityTrigger, string> = {
  passive: 'Passive',
  onDeploy: 'On deploy',
  startOfRound: 'Start of round',
  onAttack: 'On attack',
  onDamaged: 'When damaged',
  onKill: 'On kill',
  onDeath: 'On death',
};

export interface AbilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: AbilityTrigger;
  /**
   * Contribution to the owning card's power score once unlocked. This is the
   * balance dial for abilities: a heavier ability pushes the card toward the
   * next power tier, and therefore toward a higher deploy cost.
   */
  readonly weight: number;
  /** Tuning numbers read by the matching battle handler. */
  readonly params: Readonly<Record<string, number>>;
}

export function defineAbility(
  definition: Omit<AbilityDefinition, 'params'> & { params?: Record<string, number> },
): AbilityDefinition {
  return { ...definition, params: Object.freeze({ ...(definition.params ?? {}) }) };
}

export function abilityParam(ability: AbilityDefinition, key: string, fallback = 0): number {
  return ability.params[key] ?? fallback;
}
