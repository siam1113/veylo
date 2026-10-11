import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTION_API_VERSION, notionHeaders, notionPagePagination, notionPageReference, notionSearchPayload } from '../src/notion-pagination.ts';

test('Notion API calls use the current version and preserve the selected auth scheme', () => {
  assert.equal(NOTION_API_VERSION, '2026-03-11');
  assert.deepEqual(notionHeaders('Basic dGVzdDpwYXNz'), {
    Authorization: 'Basic dGVzdDpwYXNz',
    'Notion-Version': '2026-03-11',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  assert.equal(notionHeaders('Bearer token').Authorization, 'Bearer token');
});

test('Notion search requests use the page limit and pass through cursors', () => {
  assert.deepEqual(notionSearchPayload(), {
    page_size: 100,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });
  assert.deepEqual(notionSearchPayload('cursor-id'), {
    page_size: 100,
    start_cursor: 'cursor-id',
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });
});

test('Notion pagination stops when the provider omits a next cursor', () => {
  assert.deepEqual(notionPagePagination({ has_more: true, next_cursor: 'next-page' }), {
    nextCursor: 'next-page', hasMore: true,
  });
  assert.deepEqual(notionPagePagination({ has_more: false, next_cursor: 'unused' }), {
    nextCursor: 'unused', hasMore: false,
  });
  assert.deepEqual(notionPagePagination({ has_more: true, next_cursor: null }), {
    nextCursor: null, hasMore: false,
  });
});

test('Notion page search results extract titles from page title properties', () => {
  assert.deepEqual(notionPageReference({
    object: 'page',
    id: 'page-id',
    properties: { Name: { type: 'title', title: [{ plain_text: 'A saved page' }] } },
    url: 'https://www.notion.so/page-id',
    last_edited_time: '2026-10-10T00:00:00.000Z',
  }), {
    id: 'page-id', kind: 'page', title: 'A saved page', url: 'https://www.notion.so/page-id',
    lastEditedAt: '2026-10-10T00:00:00.000Z',
  });
});

test('Notion data source results with schema-shaped title metadata do not crash reference mapping', () => {
  assert.deepEqual(notionPageReference({
    object: 'data_source',
    id: 'data-source-id',
    properties: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } },
  }), {
    id: 'data-source-id', kind: 'database', title: 'Untitled database',
    url: 'https://www.notion.so/datasourceid', lastEditedAt: null,
  });
  assert.equal(notionPageReference({ object: 'page' }), null);
});
