import type { SyncIntention, IntentionHistoryEntry } from './sync.client';
import type { ThoughtIconName } from '../components/ThoughtIcon';
export type ThoughtEvent = { id: string; title: string; time: string; icon: ThoughtIconName; detail?: string; questions?: string[] };
export function thoughtTimeline(item: SyncIntention, history: IntentionHistoryEntry[]): ThoughtEvent[] {
  const events: ThoughtEvent[] = [];
  for (const [versionIndex, version] of (item.originalVersions ?? []).entries()) for (const [pieceIndex, piece] of version.pieces.entries()) {
    events.push({ id: `piece-${piece.id}`, title: versionIndex === 0 && pieceIndex === 0 ? 'Idea added' : pieceIndex === 0 ? 'New version started' : 'Piece added', time: piece.createdAt, icon: pieceIndex === 0 && versionIndex > 0 ? 'version' : 'added', detail: `Version ${versionIndex + 1}, piece ${pieceIndex + 1}` });
    if (piece.syncedAt) events.push({ id: `synced-${piece.id}`, title: 'Synced', time: piece.syncedAt, icon: 'synced', detail: `Version ${versionIndex + 1}, piece ${pieceIndex + 1} saved to your account` });
  }
  for (const entry of history) {
    if (['created', 'piece_added', 'version_started'].includes(entry.action)) continue;
    const clarified = entry.changedFields.some((field) => ['intent', 'purpose', 'desiredOutcome', 'roughPlan', 'horizon', 'effortEstimate', 'energyContext'].includes(field));
    const title = entry.action === 'ai_requested' ? 'Polish requested' : entry.action === 'ai_suggestion' ? 'Idea polished' : entry.action === 'ai_undo' ? 'Polish undone' : entry.action === 'status_changed' ? 'Status changed' : clarified ? 'You clarified' : 'Thought updated';
    events.push({ id: entry.id, title, time: entry.createdAt, icon: entry.action.startsWith('ai_') ? 'polished' : clarified ? 'clarified' : 'original' });
    if (entry.action === 'ai_suggestion' && entry.details?.questions?.length) events.push({ id: `${entry.id}-questions`, title: 'Questions asked', time: entry.createdAt, icon: 'asked', questions: entry.details.questions });
    if (entry.action === 'updated' || entry.action === 'status_changed') events.push({ id: `${entry.id}-sync`, title: 'Synced', time: entry.createdAt, icon: 'synced', detail: 'Your changes were saved to your account' });
  }
  return events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
