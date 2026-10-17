create table people (id uuid primary key, email text not null, name text);
create table audit_log (id bigserial, at timestamptz default now(), body jsonb);
create table webhook_events (id text primary key, received_at timestamptz);
