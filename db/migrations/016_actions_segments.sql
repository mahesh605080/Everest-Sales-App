-- What the field said about a suggested action, and how often each class of customer should be visited.
create table action_feedback (
  id bigserial primary key, key text not null, user_id int not null references users(id), customer_id int references customers(id),
  kind text not null, outcome text not null check (outcome in ('done','later','no')), reason text, hide_until date not null, at timestamptz not null default now());
create index on action_feedback(key, hide_until);
create index on action_feedback(at);
insert into settings(key,value,label,unit) values
 ('visit_days_a','15','Class A customers (top 80% of sales) should be visited every','days'),
 ('visit_days_b','30','Class B customers (next 15% of sales) should be visited every','days'),
 ('visit_days_c','60','Class C customers should be visited every','days')
on conflict(key) do nothing;
