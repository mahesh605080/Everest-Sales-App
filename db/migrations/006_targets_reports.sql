-- Phase 5: monthly targets, incentive, scorecard, reports
create table targets (
  id serial primary key, user_id int not null references users(id), month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric(14,2) not null check (amount >= 0), updated_by int references users(id), updated_at timestamptz not null default now(), unique (user_id, month));
insert into settings(key,value,label,unit) values
 ('incentive_pct_at_90','0.2','Incentive when month sales reach 90% of target (percent of target)','%'),
 ('incentive_pct_at_100','0.4','Incentive when month sales reach 100% of target (percent of target)','%'),
 ('visits_per_day_norm','4','Visits expected per working day when there is no tour plan','visits')
on conflict(key) do nothing;
update roles set permissions = permissions || '["targets.manage"]'::jsonb where key in ('gm','admin') and not permissions ? 'targets.manage';
update roles set permissions = permissions || '["scorecard.view","reports.run"]'::jsonb where key in ('asm','rsm','gm','admin') and not permissions ? 'scorecard.view';
update roles set permissions = permissions || '["reports.run"]'::jsonb where key = 'cc' and not permissions ? 'reports.run';
