-- In-app notifications, and a way to end every session of a user at once
create table notifications (
  id bigserial primary key, user_id int not null references users(id), title text not null, body text, link text,
  at timestamptz not null default now(), read_at timestamptz);
create index notifications_user on notifications(user_id, at desc);
alter table users add column token_version int not null default 0;
