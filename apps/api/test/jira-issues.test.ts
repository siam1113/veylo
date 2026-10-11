import assert from 'node:assert/strict';
import test from 'node:test';
import { jiraAssignedIssuesQuery, jiraIssueReferences, jiraSiteBase } from '../src/jira-issues.ts';

test('Jira search is restricted to the signed-in user’s assigned issues and reference fields', () => {
  assert.deepEqual(jiraAssignedIssuesQuery, {
    jql: 'assignee = currentUser() ORDER BY updated DESC',
    maxResults: 30,
    fields: ['summary', 'status', 'duedate', 'updated', 'project', 'issuetype', 'priority'],
  });
  assert.equal(JSON.stringify(jiraAssignedIssuesQuery).includes('description'), false);
  assert.equal(jiraSiteBase('https://example.atlassian.net/'), 'https://example.atlassian.net');
  assert.equal(jiraSiteBase('http://example.atlassian.net'), null);
  assert.equal(jiraSiteBase('javascript:alert(1)'), null);
});

test('Jira results become safe compact references with an encoded issue key', () => {
  const issues = jiraIssueReferences({ issues: [{
    id: '10001', key: 'GARDEN/7',
    fields: {
      summary: 'Ask about the garden', status: { name: 'In Progress' }, project: { name: 'Garden' },
      issuetype: { name: 'Task' }, priority: { name: 'Medium' }, duedate: '2026-11-01', updated: '2026-10-10T12:00:00.000Z',
      description: 'This private description is deliberately not imported.',
    },
  }] }, 'https://example.atlassian.net/');

  assert.deepEqual(issues, [{
    id: '10001', key: 'GARDEN/7', summary: 'Ask about the garden', status: 'In Progress', project: 'Garden',
    issueType: 'Task', priority: 'Medium', dueDate: '2026-11-01', updatedAt: '2026-10-10T12:00:00.000Z',
    url: 'https://example.atlassian.net/browse/GARDEN%2F7',
  }]);
});

test('Jira mapping skips malformed rows, supplies safe defaults, and respects the provider limit', () => {
  const issues = jiraIssueReferences({ issues: [
    null,
    { id: 'missing-key', fields: {} },
    { id: '10002', key: 'WORK-2', fields: {} },
    ...Array.from({ length: 35 }, (_, index) => ({ id: String(index + 3), key: `WORK-${index + 3}`, fields: {} })),
  ] }, 'javascript:alert(1)');

  assert.equal(issues.length, 28);
  assert.deepEqual(issues[0], {
    id: '10002', key: 'WORK-2', summary: 'Untitled issue', status: 'Unknown', project: '', issueType: '',
    priority: null, dueDate: null, updatedAt: null, url: null,
  });
});
