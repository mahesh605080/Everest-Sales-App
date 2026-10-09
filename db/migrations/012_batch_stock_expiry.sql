-- Batch-wise company stock with expiry, near-expiry offer slabs, and batch details on order lines
create table stock_uploads (id serial primary key, as_of date not null, file_name text, mode text not null, rows_ok int not null, rows_failed int not null, uploaded_by int references users(id), at timestamptz not null default now());
create table stock_batches (
  id serial primary key, product_id int not null references products(id), batch_no text not null, expiry_date date not null,
  qty_boxes int not null check (qty_boxes >= 0), location text not null default 'Main', as_of date not null, upload_id int references stock_uploads(id),
  updated_at timestamptz not null default now(), unique (product_id, batch_no, location));
create index stock_batches_expiry on stock_batches(expiry_date) where qty_boxes > 0;

-- A pre-approved price for stock that is close to expiry: no booklet needed, sold as non-returnable.
create table expiry_offers (
  id serial primary key, months_from numeric(4,1) not null, months_to numeric(4,1) not null, discount_pct numeric(5,2) not null default 0,
  bonus_buy int not null default 0, bonus_free int not null default 0, active boolean not null default true, check (months_to > months_from));
insert into expiry_offers(months_from, months_to, discount_pct) values (0, 3, 30), (3, 6, 15);

alter table sales_order_items add column batch_id int references stock_batches(id) on delete set null;
alter table sales_order_items add column batch_no text;
alter table sales_order_items add column expiry_date date;
alter table sales_order_items add column non_returnable boolean not null default false;
alter table stock_report_items add column nearest_expiry date;

insert into settings(key,value,label,unit) values
 ('near_expiry_months','6','Stock counts as near-expiry when it expires within','months'),
 ('min_shelf_life_months','2','Never sell stock with less remaining shelf life than','months'),
 ('max_cover_months','3','A distributor should not hold more than this many months of sale','months')
on conflict(key) do nothing;
insert into alert_rules(key,label,enabled,threshold,unit,sort) values ('expiry_risk','Company stock that will not sell before expiry at the current rate (weekly summary)',true,null,null,10) on conflict(key) do nothing;

update roles set permissions = permissions || '["inventory.view"]'::jsonb where key in ('so','asm','rsm','gm','cc','admin') and not permissions ? 'inventory.view';
update roles set permissions = permissions || '["inventory.manage"]'::jsonb where key in ('gm','cc','admin') and not permissions ? 'inventory.manage';
