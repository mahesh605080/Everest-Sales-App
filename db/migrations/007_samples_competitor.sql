-- Samples and gifts given in the field, and competitor information
create table samples (
  id serial primary key, user_id int not null references users(id), customer_id int not null references customers(id), day date not null,
  kind text not null check (kind in ('Sample','Gift','Promotional material')), product_id int references products(id), item text,
  qty int not null check (qty > 0), given_to text not null, remarks text,
  status text not null default 'Recorded', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table competitor_info (
  id serial primary key, user_id int not null references users(id), customer_id int references customers(id), day date not null,
  competitor text not null, their_product text not null, product_id int references products(id), their_rate numeric(12,2), scheme text,
  photo_id bigint references photos(id), remarks text,
  status text not null default 'Recorded', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
update roles set permissions = permissions || '["samples.create","competitor.create"]'::jsonb where key in ('so','asm') and not permissions ? 'samples.create';
update roles set permissions = permissions || '["samples.view","competitor.view"]'::jsonb where key in ('asm','rsm','gm','admin') and not permissions ? 'samples.view';
