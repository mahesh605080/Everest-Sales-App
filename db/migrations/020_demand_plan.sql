insert into settings(key,value,label,unit) values ('production_cover_days','60','The demand plan suggests making enough to cover this many days of sale','days') on conflict(key) do nothing;
