-- Everyone may use the built-in chat; take it away from a role in Roles and permissions if needed.
update roles set permissions = permissions || '["chat.use"]'::jsonb where not permissions ? 'chat.use';
