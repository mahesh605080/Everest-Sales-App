-- Audit fixes: indexes for the busiest lookups, retention setting, one duplicate setting removed
create index if not exists sales_orders_user on sales_orders(user_id, order_date);
create index if not exists booklets_user on booklets(user_id);
create index if not exists booklets_customer on booklets(customer_id, status);
create index if not exists collections_user on collections(user_id, day);
create index if not exists attendance_day on attendance(day);
create index if not exists visits_day on visits(day);
create index if not exists location_pings_at on location_pings(at);
create index if not exists photos_user_at on photos(user_id, at);
-- The "approval waiting" alert rule has its own hours; this setting did nothing.
delete from settings where key = 'approval_reminder_hours';
insert into settings(key,value,label,unit) values ('location_retention_days','180','Keep location points for','days') on conflict(key) do nothing;
insert into alert_rules(key,label,enabled,threshold,unit,sort) values ('approval_escalation','Escalate a waiting approval to the next level (hours are in Settings)',true,null,null,9) on conflict(key) do nothing;
