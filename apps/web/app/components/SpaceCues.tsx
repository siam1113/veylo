import { motion } from 'framer-motion';
import { useReducedMotionPref } from '../lib/motion-prefs.client';
import { listItemVariants, listItemTransition } from '../lib/list-motion';
import { UiIcon, type UiIconName } from './UiIcon';

export type SpaceCue = { icon: UiIconName; text: string; actionLabel?: string; actionIcon?: UiIconName; onAction?: () => void; aiSuggested?: boolean };

export function SpaceCues({ cues }: { cues: SpaceCue[] }) {
  const reduceMotion = useReducedMotionPref();
  if (!cues.length) return null;
  return (
    <div className="space-panel space-cues">
      <div className="space-panel-head"><h3>Worth a look</h3></div>
      <div className="space-cues-list">
        {cues.map((cue, index) => (
          <motion.div className={cue.aiSuggested ? 'space-cue space-cue-ai' : 'space-cue'} title={cue.aiSuggested ? 'AI suggested' : undefined} key={cue.text} initial="hidden" animate="visible" variants={listItemVariants} transition={listItemTransition(index, reduceMotion)}>
            <span className="space-cue-icon"><UiIcon name={cue.icon} /></span>
            <p>{cue.text}</p>
            {cue.actionLabel && cue.onAction ? <button type="button" className="capture-button cue-action" onClick={cue.onAction}>{cue.actionLabel}</button> : null}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
