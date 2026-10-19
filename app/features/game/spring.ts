// Swift `spring(response:dampingFraction:)` as a Reanimated withSpring config
// (stiffness = (2π/response)², damping = 2·ζ·√stiffness, mass 1). Pure, so the
// numbers are tested. The springs the Swift screens use are named below.
export type SpringConfig = { stiffness: number; damping: number; mass: number };

export function springOf(response: number, dampingFraction: number): SpringConfig {
  const stiffness = (2 * Math.PI / response) ** 2;
  return { stiffness, damping: 2 * dampingFraction * Math.sqrt(stiffness), mass: 1 };
}

/** RaidHPBar `.spring(response: 0.45, dampingFraction: 0.7)`. */
export const SPRING_RAID_HP = springOf(0.45, 0.7);
/** RelicDropCard flip `.spring(response: 0.6, dampingFraction: 0.62)`. */
export const SPRING_DROP_FLIP = springOf(0.6, 0.62);
/** Relic detail overlay `.spring(response: 0.35, dampingFraction: 0.78)`. */
export const SPRING_RELIC_DETAIL = springOf(0.35, 0.78);
/** Shard bar `.spring(response: 0.4, dampingFraction: 0.7)`. */
export const SPRING_SHARD_BAR = springOf(0.4, 0.7);
/** Rooms hosting panel `.spring(response: 0.4, dampingFraction: 0.8)`. */
export const SPRING_ROOM_HOST = springOf(0.4, 0.8);
/** Rooms private toggle `.spring(response: 0.3, dampingFraction: 0.7)`. */
export const SPRING_ROOM_TOGGLE = springOf(0.3, 0.7);
