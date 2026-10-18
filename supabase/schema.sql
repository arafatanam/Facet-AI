create table profiles(user_email text primary key,gender text,age_range text,main_goal text,age_confirmed boolean default false,consent_at timestamptz,onboarded boolean default false,keep_photos boolean default false);
create table scans(id uuid primary key default gen_random_uuid(),user_email text not null,front_path text,side_path text,status text default 'complete',overall numeric,potential numeric,tier text,psl text,result jsonb,created_at timestamptz default now());
create table plan_items(id uuid primary key default gen_random_uuid(),scan_id uuid references scans(id) on delete cascade,user_email text not null,category text,title text,reason text,effort text,impact text,time_to_result text,priority int,completed boolean default false);
create table chat_messages(id uuid primary key default gen_random_uuid(),user_email text not null,scan_id uuid,role text,content text,created_at timestamptz default now());
create table subscriptions(user_email text primary key,plan text,status text,stripe_customer_id text,stripe_subscription_id text,current_period_end timestamptz);
-- Row-level security: every table is locked. Only the server (service role) reads or writes.
-- This keeps paid fields off the wire for free users.
alter table profiles enable row level security;
alter table scans enable row level security;
alter table plan_items enable row level security;
alter table chat_messages enable row level security;
alter table subscriptions enable row level security;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('photos','photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "own uploads" on storage.objects for insert to authenticated with check(bucket_id='photos' and (storage.foldername(name))[1]=auth.uid()::text);
