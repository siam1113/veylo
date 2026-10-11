ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_provider_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_provider_check CHECK (provider IN ('google_calendar', 'jira_cloud', 'notion', 'outlook', 'clickup', 'asana', 'trello', 'todoist', 'microsoft_todo', 'linear', 'github', 'slack'));
