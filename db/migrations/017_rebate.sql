-- Yearly volume rebate for distributors: purchases in the fiscal year at or above a slab earn that percentage on the whole year's value.
create table rebate_slabs (id serial primary key, from_value numeric(16,2) not null check (from_value > 0), pct numeric(5,2) not null check (pct > 0 and pct <= 20), active boolean not null default true, created_at timestamptz not null default now());
update roles set permissions = permissions || '["rebate.view"]'::jsonb where key in ('so','asm','rsm','gm','cc','admin') and not permissions ? 'rebate.view';
update roles set permissions = permissions || '["rebate.manage"]'::jsonb where key in ('gm','admin') and not permissions ? 'rebate.manage';
