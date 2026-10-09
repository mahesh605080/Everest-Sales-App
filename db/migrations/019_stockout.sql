insert into settings(key,value,label,unit) values ('stockout_warning_days','30','Warn when company stock of a product covers fewer than','days of sale') on conflict(key) do nothing;
