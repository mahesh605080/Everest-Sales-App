-- The notification engine (platform service) writes into the same inbox as the web app. "origin" marks its rows so it does not pick them up again as new system notifications.
alter table notifications add column origin text;
-- Sending notifications by hand: to named people, and to whole groups. The Super Admin also sees the queue and can switch devices off.
update roles set permissions = permissions || '["notify.send","notify.broadcast","notify.manage"]'::jsonb where key = 'admin' and not permissions ? 'notify.send';
update roles set permissions = permissions || '["notify.send","notify.broadcast"]'::jsonb where key = 'gm' and not permissions ? 'notify.send';
