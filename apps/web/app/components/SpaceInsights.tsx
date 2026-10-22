import { motion } from 'framer-motion';
import { useReducedMotionPref } from '../lib/motion-prefs.client';
import { listItemVariants, listItemTransition } from '../lib/list-motion';
import { UiIcon, type UiIconName } from './UiIcon';

export type SpaceInsightTile = { value: string | number; label: string; icon: UiIconName };

export function SpaceInsights({ insights }: { insights: SpaceInsightTile[] }) {
  const reduceMotion = useReducedMotionPref();
  if (!insights.length) return null;
  return (
    <div className="space-stats">
      {insights.map((insight, index) => (
        <motion.div className="stat-tile" key={insight.label} initial="hidden" animate="visible" variants={listItemVariants} transition={listItemTransition(index, reduceMotion)}>
          <span className="stat-tile-icon"><UiIcon name={insight.icon} /></span>
          <span className="stat-tile-copy">
            <b>{insight.value}</b>
            <span>{insight.label}</span>
          </span>
        </motion.div>
      ))}
    </div>
  );
}
