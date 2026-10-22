import type { OriginalVersion } from '@clearhead/domain';
import type { SyncIntention } from '../lib/sync.client';
import { ThoughtIcon } from './ThoughtIcon';

export function OriginalPieces({ versions, compact = false, selectedVersionId }: { versions: OriginalVersion[]; compact?: boolean; selectedVersionId?: string }) {
  const visibleVersions = selectedVersionId ? versions.filter((version) => version.id === selectedVersionId) : versions;
  return <div className={`original-versions ${compact ? 'compact' : ''}`}>{[...visibleVersions].reverse().map((version) => {
    const number = versions.findIndex((entry) => entry.id === version.id) + 1;
    return <details className="original-version" key={version.id} open={selectedVersionId ? version.id === selectedVersionId : number === versions.length}>
      <summary><ThoughtIcon name="version" /><span>Version {number}<small>{version.pieces.length} {version.pieces.length === 1 ? 'piece' : 'pieces'}</small></span><span className="version-chevron" aria-hidden="true">⌄</span></summary>
      <div className="original-piece-list">{version.pieces.map((piece, index) => <article className="original-piece" key={piece.id}>
        <div className="original-piece-heading"><b>Piece {index + 1}</b><time dateTime={piece.createdAt}>{new Date(piece.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>
        <p>{piece.content}</p><small className="piece-sync"><ThoughtIcon name={piece.syncedAt ? 'synced' : 'timeline'} />{piece.syncedAt ? 'Synced' : 'Saved on this device · waiting to sync'}</small>
      </article>)}</div>
    </details>;
  })}</div>;
}

export function OriginalGist({ item }: { item: SyncIntention }) {
  const latest = item.originalVersions?.at(-1);
  const gist = latest ? item.originalGists?.[latest.id] : undefined;
  const previousGist = [...(item.originalVersions ?? [])].reverse().map((version) => item.originalGists?.[version.id]).find(Boolean);
  const displayed = gist ?? previousGist;
  const current = gist && gist.lastPieceId === latest?.pieces.at(-1)?.id;
  return <aside className="original-gist" aria-label="Gist of previous pieces"><div className="original-section-title"><ThoughtIcon name="polished" /><h3>Gist so far</h3></div>
    <h4>{item.title}</h4>
    {displayed ? <><p>{displayed.text}</p><small>{current ? 'From your saved pieces' : 'Previous gist · newer pieces are still being considered'}</small></>
      : <><p className="gist-excerpt">{(latest?.pieces.at(-1)?.content || item.rawCapture).slice(0, 360)}{(latest?.pieces.at(-1)?.content || item.rawCapture).length > 360 ? '…' : ''}</p><small>Original excerpt. A gist appears after AI polishing.</small></>}
  </aside>;
}

export function OriginalThought({ item, onDump, selectedVersionId }: { item: SyncIntention; onDump: (newVersion: boolean) => void; selectedVersionId?: string }) {
  return <div className="original-thought">
    <OriginalGist item={item} />
    <div className="original-toolbar"><div><h2>Your idea, in your words</h2><p>Add a piece whenever something new comes to mind. Start a new session when the idea takes a new direction.</p></div><div className="original-actions"><button className="save-detail" disabled={item.status === 'archived'} onClick={() => onDump(false)}><ThoughtIcon name="added" />Dump again</button><button className="outline-button" disabled={item.status === 'archived'} onClick={() => onDump(true)}><ThoughtIcon name="version" />Start a new session</button></div></div>
    <OriginalPieces versions={item.originalVersions ?? []} selectedVersionId={selectedVersionId} />
  </div>;
}
