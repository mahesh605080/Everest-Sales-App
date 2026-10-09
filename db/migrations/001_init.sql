-- Phase 1: access, masters, audit, settings, location pings
create table roles (
  id serial primary key, key text unique not null, name text not null, level int not null default 1,
  permissions jsonb not null default '[]', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table regions (
  id serial primary key, code text unique not null, name text not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table areas (
  id serial primary key, code text unique not null, name text not null, region_id int not null references regions(id),
  hq_town text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table users (
  id serial primary key, code text unique not null, name text not null, phone text unique, email text,
  password_hash text not null, role_id int not null references roles(id), manager_id int references users(id),
  region_id int references regions(id), area_id int references areas(id), join_date date,
  active boolean not null default true, must_change_password boolean not null default true,
  failed_logins int not null default 0, locked_until timestamptz, last_login_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table product_categories (
  id serial primary key, code text unique not null, name text not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table products (
  id serial primary key, code text unique not null, name text not null, generic_name text,
  category_id int not null references product_categories(id), strength text, pack_size text,
  units_per_box int not null default 1 check (units_per_box > 0),
  mrp numeric(12,2) not null default 0, trade_rate numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table payment_terms (
  id serial primary key, code text unique not null, name text not null, credit_days int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table customers (
  id serial primary key, code text unique not null, name text not null,
  type text not null check (type in ('Distributor','Hospital','Institution','Retailer')),
  pan_vat text, dda_licence_no text, dda_expiry date, address text, town text,
  lat double precision, lng double precision, contact_person text, phone text,
  area_id int references areas(id), payment_term_id int references payment_terms(id),
  credit_limit numeric(14,2) not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by int, updated_by int);

create table customer_assignments (
  id serial primary key, customer_id int not null references customers(id), user_id int not null references users(id),
  from_date date not null default current_date, to_date date, created_by int, created_at timestamptz not null default now());
create unique index customer_assignments_current on customer_assignments(customer_id) where to_date is null;
create index customer_assignments_user on customer_assignments(user_id) where to_date is null;

create table audit_logs (
  id bigserial primary key, user_id int, user_name text, action text not null, entity text not null, entity_id text,
  before jsonb, after jsonb, ip text, at timestamptz not null default now());
create index audit_logs_at on audit_logs(at desc);

create table settings (key text primary key, value text not null, label text not null, unit text, updated_at timestamptz not null default now(), updated_by int);

create table location_pings (
  id bigserial primary key, user_id int not null references users(id), lat double precision not null, lng double precision not null,
  accuracy double precision, at timestamptz not null default now());
create index location_pings_user_at on location_pings(user_id, at desc);
