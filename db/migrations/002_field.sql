-- Phase 2: attendance, customer visits, alerts
create table attendance (
  id serial primary key, user_id int not null references users(id), day date not null,
  in_at timestamptz not null default now(), in_lat double precision, in_lng double precision, in_accuracy double precision,
  out_at timestamptz, out_lat double precision, out_lng double precision,
  projection numeric(14,2) not null default 0, actual numeric(14,2),
  late boolean not null default false, auto_closed boolean not null default false,
  unique (user_id, day));

create table visits (
  id serial primary key, user_id int not null references users(id), customer_id int not null references customers(id), day date not null,
  in_at timestamptz not null default now(), in_lat double precision, in_lng double precision, in_accuracy double precision,
  distance_m int, out_of_fence boolean not null default false,
  out_at timestamptz, out_lat double precision, out_lng double precision,
  purpose text, person_met text, remarks text, next_visit date);
create unique index visits_one_open on visits(user_id) where out_at is null;
create index visits_user_day on visits(user_id, day);
create index visits_customer on visits(customer_id, in_at desc);

create table alert_rules (key text primary key, label text not null, enabled boolean not null default true, threshold numeric, unit text, sort int not null default 0);
insert into alert_rules(key,label,enabled,threshold,unit,sort) values
 ('no_checkin','No check-in by this time (minutes after midnight; 600 = 10:00)',true,600,'minutes',1),
 ('idle','Checked in but no visit for',true,120,'minutes',2),
 ('geofence','Visit started outside the geo-fence (radius is in Settings)',true,null,null,3),
 ('missed_checkout','Day ended without a check-out',true,null,null,4),
 ('coverage','Assigned customers not visited for',true,30,'days',5);

create table alerts (
  id bigserial primary key, rule text not null, severity text not null default 'warn', user_id int references users(id), customer_id int references customers(id),
  message text not null, day date not null, key text unique not null, at timestamptz not null default now(), ack_by int references users(id), ack_at timestamptz);
create index alerts_open on alerts(at desc) where ack_at is null;

-- new permissions for the existing roles
update roles set permissions = permissions || '["field.use"]'::jsonb where key in ('so','asm','rsm') and not permissions ? 'field.use';
update roles set permissions = permissions || '["team.view","alerts.view"]'::jsonb where key in ('asm','rsm','gm','admin') and not permissions ? 'team.view';
update roles set permissions = permissions || '["alerts.manage","field.use"]'::jsonb where key = 'admin' and not permissions ? 'alerts.manage';
