-- Which batches actually left with each order line. Dispatch takes them out of the company stock and makes returns traceable.
create table dispatch_batches (
  id bigserial primary key, order_id int not null references sales_orders(id), order_item_id int not null references sales_order_items(id),
  customer_id int not null references customers(id), product_id int not null references products(id),
  batch_id int references stock_batches(id), batch_no text not null, expiry_date date, qty int not null check (qty > 0), at timestamptz not null default now());
create index on dispatch_batches(customer_id, product_id);
create index on dispatch_batches(order_id);
