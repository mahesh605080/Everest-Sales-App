-- File storage: everyone may keep and share files; only the Super Admin sees all of them.
update roles set permissions = permissions || '["files.use"]'::jsonb where not permissions ? 'files.use';
update roles set permissions = permissions || '["files.manage"]'::jsonb where key = 'admin' and not permissions ? 'files.manage';
