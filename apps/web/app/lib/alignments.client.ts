import { alignmentContentSchema, alignmentRecordSchema, alignmentWriteSchema, type AlignmentContent, type AlignmentRecord } from '@clearhead/domain';

export type LocalAlignment = Omit<AlignmentRecord, 'version'> & {
  version: number | null; syncState: 'pending' | 'synced' | 'conflict'; mutationId?: string;
  conflict?: AlignmentRecord; syncError?: string;
};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** One account-scoped, atomic browser record contains both entries and pending writes. */
export function createAlignmentStore(options: {
  key: string; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  request: Request; onChange: (rows: LocalAlignment[]) => void; isClosed: () => boolean;
}) {
  let rows: LocalAlignment[] = [];
  const raw = options.storage.getItem(options.key);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Saved Align data could not be read. Export your device data before clearing storage.');
    rows = parsed.map((value) => {
      const input = alignmentWriteSchema.parse({ ...value, expectedVersion: value.version, mutationId: value.mutationId ?? value.id });
      return { ...input, id: input.id, version: input.expectedVersion, updatedAt: value.updatedAt, syncState: value.syncState, mutationId: value.mutationId, conflict: value.conflict, syncError: value.syncError } as LocalAlignment;
    });
  }
  function commit(next: LocalAlignment[]) {
    if (options.isClosed()) return;
    // A failed storage write leaves the editor open and the prior data intact.
    options.storage.setItem(options.key, JSON.stringify(next));
    rows = next;
    options.onChange(rows);
  }
  return {
    get rows() { return rows; },
    save(input: AlignmentContent & { id?: string }, expectedVersion: number | null, replaceConflict = false) {
      if (options.isClosed()) throw new Error('This session is closing.');
      const content = alignmentContentSchema.parse(input);
      const previous = rows.find((row) => row.id === input.id);
      if (previous && previous.version !== expectedVersion) throw new Error('This entry changed while you were editing. Close and reopen it to review the latest version.');
      if (previous?.conflict && !replaceConflict) throw new Error('Close and reopen this entry to review the synced version before replacing it.');
      const row: LocalAlignment = { ...content, id: input.id ?? crypto.randomUUID(), version: replaceConflict ? previous?.conflict?.version ?? expectedVersion : previous?.version ?? null, updatedAt: new Date().toISOString(), syncState: 'pending', mutationId: crypto.randomUUID() };
      commit([row, ...rows.filter((entry) => entry.id !== row.id)]);
      return row;
    },
    useSynced(id: string) {
      const entry = rows.find((row) => row.id === id);
      if (entry?.conflict) commit(rows.map((row) => row.id === id ? { ...entry.conflict!, syncState: 'synced' } : row));
    },
    async sync() {
      for (const pending of rows.filter((row) => row.syncState === 'pending')) {
        if (options.isClosed()) return;
        try {
          const { alignment } = await options.request<{ alignment: AlignmentRecord }>('/alignments', { method: 'PUT', body: JSON.stringify({ ...alignmentContentSchema.parse(pending), id: pending.id, mutationId: pending.mutationId, expectedVersion: pending.version }) });
          const saved = alignmentRecordSchema.parse(alignment);
          if (options.isClosed()) return;
          commit(rows.map((row) => row.id !== saved.id ? row : row.mutationId === pending.mutationId ? { ...saved, syncState: 'synced' } : { ...row, version: saved.version }));
        } catch (error) {
          if (options.isClosed()) return;
          const result = error as { statusCode?: number; responseBody?: { current?: unknown }; message?: string };
          const current = alignmentRecordSchema.safeParse(result.responseBody?.current);
          if (result.statusCode === 409 && current.success) {
            commit(rows.map((row) => row.id === pending.id ? { ...row, syncState: 'conflict', conflict: current.data } : row));
            continue;
          }
          commit(rows.map((row) => row.id === pending.id ? { ...row, syncError: result.message ?? 'Could not sync this entry.' } : row));
          throw error;
        }
      }
      const result = await options.request<{ alignments: AlignmentRecord[] }>('/alignments');
      if (options.isClosed()) return;
      const merged = new Map<string, LocalAlignment>(result.alignments.map((row) => { const valid = alignmentRecordSchema.parse(row); return [valid.id, { ...valid, syncState: 'synced' as const }]; }));
      for (const row of rows) if (row.syncState !== 'synced') merged.set(row.id, row);
      commit([...merged.values()]);
    },
    clearThoughtLinks() {
      commit(rows.map((row) => ({ ...row, intentionIds: [], conflict: row.conflict ? { ...row.conflict, intentionIds: [] } : undefined })));
    },
    // Optimistic, like the other mutations here: removed from the local view immediately,
    // with the server call following. A row with version === null never synced, so there is
    // nothing on the server to delete.
    async delete(id: string) {
      if (options.isClosed()) return;
      const entry = rows.find((row) => row.id === id);
      if (!entry) return;
      commit(rows.filter((row) => row.id !== id));
      if (entry.version !== null) await options.request(`/alignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
