import type { Transition, Variants } from 'framer-motion';

/** Shared enter/exit shape for cards and rows in Explore and Align: a soft rise-and-settle
 * in, a quick shrink-away out. Paired with `listItemTransition` below for the stagger. */
export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

/** Entrance stagger by position, capped so a long list doesn't make the last card wait
 * seconds to appear. Honors the reduced-motion preference by collapsing to an instant cut. */
export function listItemTransition(index: number, reduceMotion: boolean): Transition {
  if (reduceMotion) return { duration: 0 };
  return { type: 'spring', stiffness: 420, damping: 32, mass: 0.8, delay: Math.min(index, 10) * 0.035 };
}

/** Reflow transition for cards shifting position when a sibling is added/removed.
 * Deliberately undelayed and uniform across every card — if this inherited the
 * entrance stagger's per-index delay, removing one item would make the rest of the
 * list cascade into place at staggered times instead of sliding together. */
function listLayoutTransition(reduceMotion: boolean): Transition {
  return reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40, mass: 0.7 };
}

/** Combined transition for `layout`-animated list cards: staggered spring for the
 * enter/exit variant, instant uniform spring for sibling reflow. Pair with
 * `layout="position"` (not bare `layout`) — animating size here on top of the
 * variant's own `scale` double-applies scale via Motion's layout projection and reads
 * as stutter/jitter, so position-only layout plus this split transition avoids it. */
export function listCardTransition(index: number, reduceMotion: boolean): Transition {
  return { default: listItemTransition(index, reduceMotion), layout: listLayoutTransition(reduceMotion) };
}

export const listHoverLift = { y: -4, transition: { type: 'spring', stiffness: 400, damping: 25 } as Transition };
export const listRowHoverLift = { x: 2, transition: { type: 'spring', stiffness: 400, damping: 25 } as Transition };
export const listTap = { scale: 0.97 };
