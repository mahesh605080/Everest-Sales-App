-- Suggested orders from distributor run-rate
insert into settings(key,value,label,unit) values ('target_cover_days','45','A suggested order fills the distributor up to this many days of sale','days') on conflict(key) do nothing;
