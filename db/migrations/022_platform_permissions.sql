-- Permissions used by the platform service. The Super Admin gets them; hand them to other roles from Roles and permissions.
update roles set permissions = permissions || '["data.manage"]'::jsonb where key = 'admin' and not permissions ? 'data.manage';
