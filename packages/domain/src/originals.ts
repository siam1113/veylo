import { z } from 'zod';

export const originalPieceInputSchema = z.object({
  id: z.string().uuid(), versionId: z.string().uuid(),
  content: z.string().min(1).max(8000).refine((value) => Boolean(value.trim()), 'Write something before saving this piece.'),
  createdAt: z.string().datetime(), startNewVersion: z.boolean().default(false),
}).strict();
export const originalPieceSchema = z.object({
  id: z.string().uuid(), content: z.string().min(1).max(8000), createdAt: z.string().datetime(), syncedAt: z.string().datetime().nullable(),
});
export const originalVersionSchema = z.object({
  id: z.string().uuid(), createdAt: z.string().datetime(), pieces: z.array(originalPieceSchema).min(1),
});
export const originalVersionsSchema = z.array(originalVersionSchema);
export type OriginalPiece = z.infer<typeof originalPieceSchema>;
export type OriginalVersion = z.infer<typeof originalVersionSchema>;
export type OriginalPieceInput = z.infer<typeof originalPieceInputSchema>;
export type OriginalGist = { text: string; lastPieceId: string; generatedAt: string };
export const originalGistsSchema = z.record(z.string(), z.object({ text: z.string().max(2000), lastPieceId: z.string().uuid(), generatedAt: z.string().datetime() }));

export function initialOriginalVersions(clientId: string, rawCapture: string, createdAt: string, syncedAt: string | null = null): OriginalVersion[] {
  return [{ id: clientId, createdAt, pieces: [{ id: clientId, content: rawCapture, createdAt, syncedAt }] }];
}

/** Append-only raw captures; replaying an id never rewrites its words. */
export function appendOriginalPiece(versions: OriginalVersion[], input: OriginalPieceInput, syncedAt: string | null): OriginalVersion[] {
  const existing = versions.flatMap((version) => version.pieces.map((piece) => ({ versionId: version.id, piece }))).find(({ piece }) => piece.id === input.id);
  if (existing) {
    if (existing.versionId !== input.versionId || existing.piece.content !== input.content) throw new Error('This piece was already saved with different words.');
    return versions;
  }
  const target = versions.find((version) => version.id === input.versionId);
  if (!target && !input.startNewVersion) throw new Error('This version is unavailable. Reopen the thought and try again.');
  const piece: OriginalPiece = { id: input.id, content: input.content, createdAt: input.createdAt, syncedAt };
  return target ? versions.map((version) => version.id === target.id ? { ...version, pieces: [...version.pieces, piece] } : version)
    : [...versions, { id: input.versionId, createdAt: input.createdAt, pieces: [piece] }];
}

/** Keep unsent pieces when another device or AI updates the thought. */
export function mergeOriginalVersions(remote: OriginalVersion[], local: OriginalVersion[] = []): OriginalVersion[] {
  const known = new Set(remote.flatMap((version) => version.pieces.map((piece) => piece.id)));
  let merged = remote;
  for (const version of local) for (const piece of version.pieces) {
    if (piece.syncedAt || known.has(piece.id)) continue;
    merged = appendOriginalPiece(merged, { ...piece, versionId: version.id, startNewVersion: true }, null);
    known.add(piece.id);
  }
  return merged;
}

export function originalContext(versions: OriginalVersion[], maxCharacters = 60000): string {
  // Preserve source text in storage; send a bounded recent window to the model.
  const pieces = versions.flatMap((version, index) => version.pieces.map((piece) => `Version ${index + 1}, captured ${piece.createdAt}:\n${piece.content}`));
  const kept: string[] = []; let remaining = maxCharacters;
  for (const piece of pieces.reverse()) {
    if (piece.length > remaining) break;
    kept.unshift(piece); remaining -= piece.length + 2;
  }
  return `${kept.length < pieces.length ? '[Earlier pieces omitted from this evaluation window.]\n' : ''}${kept.join('\n\n')}`;
}
