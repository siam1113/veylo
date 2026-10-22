/** Pulls the response text out of the Responses API's REST JSON. The typed SDK exposes a
 * computed `output_text` getter; the raw REST body carries the same field for simple text
 * replies, but we still fall back to walking `output` defensively since that convenience
 * field isn't part of the documented response schema. */
export function extractOutputText(data: unknown): string {
  if (data && typeof data === 'object' && typeof (data as { output_text?: unknown }).output_text === 'string') {
    return (data as { output_text: string }).output_text;
  }
  const output = (data as { output?: unknown })?.output;
  if (!Array.isArray(output)) return '';
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const piece of content) {
      if (piece && typeof piece === 'object' && typeof (piece as { text?: unknown }).text === 'string') return (piece as { text: string }).text;
    }
  }
  return '';
}
