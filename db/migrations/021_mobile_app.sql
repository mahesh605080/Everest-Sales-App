-- For the mobile app: an order or request sent twice (after a lost connection) is stored once; faked GPS is recorded; pings can arrive in a batch with their own time.
alter table sales_orders add column client_ref text;
create unique index sales_orders_client_ref on sales_orders(user_id, client_ref) where client_ref is not null;
alter table collections add column client_ref text;
create unique index collections_client_ref on collections(user_id, client_ref) where client_ref is not null;
alter table claims add column client_ref text;
create unique index claims_client_ref on claims(user_id, client_ref) where client_ref is not null;
alter table visits add column mock_location boolean not null default false, add column source text;
alter table location_pings add column mocked boolean not null default false;
insert into alert_rules(key,label,enabled,threshold,unit,sort) values ('mock_location','Phone reported a faked (mock) GPS location',true,null,null,11) on conflict(key) do nothing;
