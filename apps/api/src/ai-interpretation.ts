export type AIInterpretationSnapshot = {
  title: string;
  kind: string;
  horizon: string | null;
};

export type AIInterpretationUndo = {
  previous: AIInterpretationSnapshot;
  applied: AIInterpretationSnapshot;
  tracksHorizon: boolean;
};

export function getAIInterpretationUndo(
  metadata: Record<string, unknown>,
  current: AIInterpretationSnapshot,
): AIInterpretationUndo | null {
  if (typeof metadata.processedAt !== 'string' || metadata.undoneAt) return null;
  if (typeof metadata.previousTitle !== 'string' || typeof metadata.previousKind !== 'string') return null;
  if (typeof metadata.appliedTitle !== 'string' || typeof metadata.appliedKind !== 'string') return null;
  if (metadata.appliedTitle !== current.title || metadata.appliedKind !== current.kind) return null;

  const tracksHorizon = Object.hasOwn(metadata, 'appliedHorizon');
  const appliedHorizon = tracksHorizon ? metadata.appliedHorizon : current.horizon;
  const previousHorizon = tracksHorizon ? metadata.previousHorizon : current.horizon;
  if ((appliedHorizon !== null && typeof appliedHorizon !== 'string')
    || (previousHorizon !== null && typeof previousHorizon !== 'string')
    || appliedHorizon !== current.horizon) return null;

  return {
    previous: {
      title: metadata.previousTitle,
      kind: metadata.previousKind,
      horizon: previousHorizon,
    },
    applied: {
      title: metadata.appliedTitle,
      kind: metadata.appliedKind,
      horizon: appliedHorizon,
    },
    tracksHorizon,
  };
}

/** True only when the live row still contains the complete AI-applied snapshot. */
export function matchesAIOnlyChange(
  metadata: Record<string, unknown>,
  base: AIInterpretationSnapshot,
  current: AIInterpretationSnapshot,
): boolean {
  const undo = getAIInterpretationUndo(metadata, current);
  return undo !== null
    && undo.previous.title === base.title
    && undo.previous.kind === base.kind
    && undo.previous.horizon === base.horizon;
}
