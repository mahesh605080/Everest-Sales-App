-- Each inbox row records when it was handed to the push queue. The platform's worker picks up rows where this is empty,
-- so a row is never missed even when two notifications are saved at the same moment.
alter table notifications add column pushed_at timestamptz;
create index notifications_unpushed on notifications (id) where pushed_at is null and origin is null;
