export const NOTION_API_VERSION = '2026-03-11';

export function notionHeaders(authorization: string) {
  return {
    Authorization: authorization,
    'Notion-Version': NOTION_API_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export const notionSearchPayload = (cursor?: string) => ({
  page_size: 100,
  ...(cursor ? { start_cursor: cursor } : {}),
  sort: { direction: 'descending' as const, timestamp: 'last_edited_time' as const },
});

export function notionPagePagination(result: { has_more?: boolean; next_cursor?: string | null }) {
  const nextCursor = result.next_cursor ?? null;
  return { nextCursor, hasMore: result.has_more === true && Boolean(nextCursor) };
}

type NotionRecord = Record<string, unknown>;

function objectValue(value: unknown): NotionRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as NotionRecord : null;
}

function titleText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    const record = objectValue(part);
    if (typeof record?.plain_text === 'string') return record.plain_text;
    const text = objectValue(record?.text);
    return typeof text?.content === 'string' ? text.content : '';
  }).join('');
}

/** Convert Notion's page and data_source search variants to the small read-only reference shown in Veylo. */
export function notionPageReference(value: NotionRecord) {
  if (typeof value.id !== 'string' || !value.id) return null;
  const properties = objectValue(value.properties);
  const titleProperty = properties
    ? Object.values(properties).map(objectValue).find((property) => property?.type === 'title')
    : null;
  const isPage = value.object === 'page';
  const title = titleText(value.title)
    || titleText(titleProperty?.title)
    || (typeof value.name === 'string' ? value.name : '')
    || (isPage ? 'Untitled page' : 'Untitled database');
  const normalizedId = value.id.replaceAll('-', '');
  return {
    id: value.id,
    kind: isPage ? 'page' as const : 'database' as const,
    title,
    url: typeof value.url === 'string' ? value.url : `https://www.notion.so/${normalizedId}`,
    lastEditedAt: typeof value.last_edited_time === 'string' ? value.last_edited_time : null,
  };
}
