import { useEffect, useState } from 'react';
import type { SyncClient, SyncIntention, IntentionHistoryEntry } from '../lib/sync.client';
import { thoughtTimeline } from '../lib/thought-timeline';
import { ThoughtIcon } from './ThoughtIcon';
export function ThoughtTimeline({ item, client }: { item: SyncIntention; client: SyncClient | null }) {
  const [history, setHistory] = useState<IntentionHistoryEntry[]>([]);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!client || !item.remoteId) { setMessage('Saved here. More activity will appear once this thought syncs.'); return; }
    setMessage('Loading activity…');
    void client.getIntentionHistory(item.remoteId).then((entries) => { if (active) { setHistory(entries); setMessage(''); } }).catch(() => { if (active) setMessage('Could not load saved activity. Your raw pieces are still here.'); });
    return () => { active = false; };
  }, [client, item.remoteId, item.version, attempt]);
  const events = thoughtTimeline(item, history);
  return <section className="thought-timeline"><p className="thought-tab-intro">How this idea has grown, one piece and conversation at a time.</p>{message ? <p role="status">{message}</p> : null}{message.startsWith('Could not') ? <button className="outline-button" onClick={() => setAttempt((value) => value + 1)}>Retry activity</button> : null}
    <ol>{events.map((event) => <li key={event.id}><span className={`timeline-event-icon ${event.icon}`}><ThoughtIcon name={event.icon} /></span><div><b>{event.title}</b><time dateTime={event.time}>{new Date(event.time).toLocaleString()}</time>{event.detail ? <p>{event.detail}</p> : null}{event.questions ? <details><summary>View {event.questions.length} {event.questions.length === 1 ? 'question' : 'questions'}</summary><ul>{event.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></details> : null}</div></li>)}</ol>
  </section>;
}
