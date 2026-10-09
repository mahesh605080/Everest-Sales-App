-- Phase 4: collections, expenses, claims, leave, distributor stock, tenders
create table collections (
  id serial primary key, user_id int not null references users(id), customer_id int not null references customers(id), day date not null,
  mode text not null check (mode in ('Cash','Cheque','Bank transfer','Online')), amount numeric(14,2) not null check (amount > 0),
  ref_no text, bank text, cheque_date date, photo_id bigint references photos(id), remarks text,
  status text not null default 'Submitted', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index collections_customer on collections(customer_id, day);

create table expenses (
  id serial primary key, user_id int not null references users(id), day date not null, route text,
  km_claimed numeric(8,1) not null default 0, km_gps numeric(8,1), over_gps boolean not null default false,
  ta numeric(12,2) not null default 0, da numeric(12,2) not null default 0, lodging numeric(12,2) not null default 0, other numeric(12,2) not null default 0, other_note text,
  total numeric(12,2) not null default 0, photo_id bigint references photos(id), remarks text,
  status text not null default 'Submitted', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index expenses_user_day on expenses(user_id, day);

create table claims (
  id serial primary key, user_id int not null references users(id), customer_id int not null references customers(id), day date not null,
  type text not null check (type in ('Expired stock','Near expiry','Breakage','Rate difference','Other')),
  product_id int references products(id), qty int, batch_no text, expiry_date date, amount numeric(14,2) not null check (amount > 0),
  photo_id bigint references photos(id), remarks text,
  status text not null default 'Submitted', created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table leaves (
  id serial primary key, user_id int not null references users(id), day date not null, from_date date not null, to_date date not null,
  type text not null check (type in ('Casual','Sick','Annual','Unpaid','Other')), days int not null, remarks text,
  status text not null default 'Submitted', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index leaves_user on leaves(user_id, from_date, to_date);

create table stock_reports (
  id serial primary key, user_id int not null references users(id), customer_id int not null references customers(id), day date not null,
  created_at timestamptz not null default now(), unique (customer_id, day));
create table stock_report_items (
  id serial primary key, report_id int not null references stock_reports(id) on delete cascade, product_id int not null references products(id),
  stock int not null default 0, sold_30d int not null default 0, near_expiry int not null default 0, unique (report_id, product_id));

create table tenders (
  id serial primary key, code text unique not null, name text not null, buyer text not null, customer_id int references customers(id),
  est_value numeric(16,2) not null default 0, emd_amount numeric(14,2) not null default 0, closing_date date,
  stage text not null default 'Identified' check (stage in ('Identified','Documents purchased','Bid preparation','Submitted','Technical evaluation','Awarded','Lost','Cancelled')),
  owner_id int references users(id), remarks text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

insert into settings(key,value,label,unit) values
 ('ta_rate_per_km','10','Travel allowance per km','Rs'),
 ('da_daily_limit','800','Daily allowance limit','Rs'),
 ('km_tolerance_pct','15','Claimed km may exceed GPS km by','%')
on conflict(key) do nothing;
insert into alert_rules(key,label,enabled,threshold,unit,sort) values ('expense_gps','Expense claim with km above the GPS distance (tolerance is in Settings)',true,null,null,8) on conflict(key) do nothing;

update roles set permissions = permissions || '["collections.create","claims.create","stock.report"]'::jsonb where key in ('so','asm') and not permissions ? 'collections.create';
update roles set permissions = permissions || '["expenses.create","leave.apply"]'::jsonb where key in ('so','asm','rsm') and not permissions ? 'expenses.create';
update roles set permissions = permissions || '["expenses.approve","leave.approve","stock.view","tenders.view","tenders.edit"]'::jsonb where key in ('asm','rsm','gm','admin') and not permissions ? 'expenses.approve';
update roles set permissions = permissions || '["claims.approve"]'::jsonb where key in ('rsm','gm','admin') and not permissions ? 'claims.approve';
update roles set permissions = permissions || '["collections.verify","expenses.pay","claims.settle","stock.view","tenders.view"]'::jsonb where key in ('cc','admin') and not permissions ? 'collections.verify';
update roles set permissions = permissions || '["tenders.view"]'::jsonb where key = 'so' and not permissions ? 'tenders.view';
