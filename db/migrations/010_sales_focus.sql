-- Sales focus: how long without an order counts as a missed customer
insert into settings(key,value,label,unit) values ('no_order_days','30','Customer counts as "not ordering" after','days') on conflict(key) do nothing;
insert into settings(key,value,label,unit) values ('reorder_cover_days','15','Suggest a reorder when distributor stock covers fewer than','days') on conflict(key) do nothing;
