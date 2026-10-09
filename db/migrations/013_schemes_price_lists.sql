-- Schemes that apply themselves on an order, and price lists by customer type or for one customer (rate contract).
create table price_rules (
  id serial primary key, code text unique not null, name text not null, product_id int not null references products(id),
  customer_type text check (customer_type in ('Distributor','Hospital','Institution','Retailer')), customer_id int references customers(id),
  rate numeric(12,4) not null check (rate > 0), valid_from date, valid_to date, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);
create index on price_rules(product_id) where active;

create table schemes (
  id serial primary key, code text unique not null, name text not null, product_id int not null references products(id),
  customer_type text check (customer_type in ('Distributor','Hospital','Institution','Retailer')),
  min_qty int not null default 1, bonus_buy int not null default 0, bonus_free int not null default 0, discount_pct numeric(5,2) not null default 0,
  valid_from date not null, valid_to date not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);
create index on schemes(product_id) where active;

alter table sales_order_items add column list_rate numeric(12,4), add column scheme_id int references schemes(id), add column scheme_text text,
  add column free_qty int not null default 0, add column price_source text;

update roles set permissions = permissions || '["schemes.view","rates.view"]'::jsonb where key in ('so','asm','rsm','gm','cc','admin') and not permissions ? 'schemes.view';
update roles set permissions = permissions || '["schemes.edit","rates.edit"]'::jsonb where key in ('gm','admin') and not permissions ? 'schemes.edit';
