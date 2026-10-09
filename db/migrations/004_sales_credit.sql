-- Phase 3: booklets, sales orders, credit control, outstanding upload, dispatch
create table financial_instruments (
  id serial primary key, customer_id int not null references customers(id),
  type text not null check (type in ('Bank Guarantee','Letter of Credit','Cheque (PDC)','Director Approval')),
  bank text, ref_no text, amount numeric(14,2) not null default 0, issue_date date, expiry_date date,
  status text not null default 'Active' check (status in ('Active','Deposited','Cleared','Bounced','Released')),
  remarks text, created_by int references users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index financial_instruments_customer on financial_instruments(customer_id);

create table outstanding_uploads (id serial primary key, as_of date not null, file_name text, rows_ok int not null, rows_failed int not null, uploaded_by int references users(id), at timestamptz not null default now());
create table outstanding_balances (
  customer_id int primary key references customers(id), total numeric(14,2) not null, b0 numeric(14,2) not null, b1 numeric(14,2) not null,
  b2 numeric(14,2) not null, b3 numeric(14,2) not null, as_of date not null, upload_id int references outstanding_uploads(id));

create sequence booklet_no_seq; create sequence sales_order_no_seq;

create table booklets (
  id serial primary key, no text unique not null, user_id int not null references users(id), customer_id int not null references customers(id),
  order_date date not null, due_date date not null, remarks text,
  status text not null default 'Pending' check (status in ('Pending','Sent back','Accepted','Rejected','Cancelled','Expired')),
  level text, final_level text not null, max_variance numeric(7,2) not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index booklets_status on booklets(status, level);
create table booklet_items (
  id serial primary key, booklet_id int not null references booklets(id) on delete cascade, product_id int not null references products(id),
  qty int not null check (qty > 0), base_rate numeric(12,2) not null, ask_rate numeric(12,2) not null,
  bonus_buy int not null default 0, bonus_free int not null default 0, discount_pct numeric(5,2) not null default 0,
  net_rate numeric(12,4) not null, variance_pct numeric(7,2) not null, remarks text, unique (booklet_id, product_id));

create table sales_orders (
  id serial primary key, no text unique not null, user_id int not null references users(id), customer_id int not null references customers(id),
  booklet_id int references booklets(id), order_date date not null, payment_term_id int references payment_terms(id),
  delivery_address text, contact_person text, contact_phone text, transport text not null default 'Company', transporter text, vehicle_no text, remarks text,
  value numeric(14,2) not null, over_limit boolean not null default false,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Dispatched','Withdrawn')),
  invoice_no text, decided_by int references users(id), decided_at timestamptz, dispatched_by int references users(id), dispatched_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index sales_orders_status on sales_orders(status);
create index sales_orders_customer on sales_orders(customer_id);
create table sales_order_items (
  id serial primary key, order_id int not null references sales_orders(id) on delete cascade, product_id int not null references products(id),
  qty int not null check (qty > 0), units_per_box int not null, rate numeric(12,4) not null, value numeric(14,2) not null);

create table approvals (
  id bigserial primary key, doc_type text not null, doc_id int not null, level text, user_id int references users(id), user_name text,
  action text not null, remarks text, at timestamptz not null default now());
create index approvals_doc on approvals(doc_type, doc_id, at);

insert into alert_rules(key,label,enabled,threshold,unit,sort) values
 ('approval_wait','Booklet or sales order waiting for approval longer than',true,24,'hours',6),
 ('instrument_expiry','Bank guarantee, LC or cheque expiring within',true,30,'days',7)
on conflict(key) do nothing;

update roles set permissions = permissions || '["booklets.create","orders.create"]'::jsonb where key in ('so','asm') and not permissions ? 'booklets.create';
update roles set permissions = permissions || '["booklets.approve"]'::jsonb where key in ('asm','rsm','gm') and not permissions ? 'booklets.approve';
update roles set permissions = permissions || '["sales.view"]'::jsonb where key in ('asm','rsm','gm','cc','admin') and not permissions ? 'sales.view';
update roles set permissions = permissions || '["credit.manage","dispatch.manage"]'::jsonb where key in ('cc','admin') and not permissions ? 'credit.manage';
update roles set permissions = permissions || '["alerts.view"]'::jsonb where key = 'cc' and not permissions ? 'alerts.view';
