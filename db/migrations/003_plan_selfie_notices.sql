-- Phase 2 (rest): selfie at check-in, monthly tour plan, notices
create table photos (id bigserial primary key, user_id int not null references users(id), kind text not null, mime text not null, data bytea not null, at timestamptz not null default now());
alter table attendance add column in_photo_id bigint references photos(id);
insert into settings(key,value,label,unit) values ('selfie_required','1','Selfie needed at check-in (1 = yes, 0 = no)','') on conflict(key) do nothing;

create table tour_plans (
  id serial primary key, user_id int not null references users(id), month text not null check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Sent back')),
  remarks text, submitted_at timestamptz, decided_by int references users(id), decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (user_id, month));
create table tour_plan_items (
  id serial primary key, plan_id int not null references tour_plans(id) on delete cascade, day date not null,
  customer_id int not null references customers(id), note text, unique (plan_id, day, customer_id));
create index tour_plan_items_day on tour_plan_items(day);

create table notices (
  id serial primary key, title text not null, body text not null, category text not null default 'General',
  role_key text, region_id int references regions(id), expires date, created_by int references users(id), at timestamptz not null default now());
create table notice_reads (notice_id int not null references notices(id) on delete cascade, user_id int not null references users(id), at timestamptz not null default now(), primary key (notice_id, user_id));

update roles set permissions = permissions || '["plan.use"]'::jsonb where key in ('so','asm') and not permissions ? 'plan.use';
update roles set permissions = permissions || '["plan.approve"]'::jsonb where key in ('asm','rsm','gm','admin') and not permissions ? 'plan.approve';
update roles set permissions = permissions || '["notices.manage"]'::jsonb where key in ('gm','admin') and not permissions ? 'notices.manage';
