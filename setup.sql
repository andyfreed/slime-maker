-- ============================================================
-- SLIME MAKER - Database Setup
-- Paste this entire file into Supabase SQL Editor and click "Run"
-- ============================================================
-- Auth UX note:
-- The app now uses a kid-friendly "name + 4-digit code" login.
-- It auto-creates accounts, so disable email confirmation in
-- Supabase Auth settings for the smoothest experience.

-- Profiles table (one per user, auto-created on signup)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  coins integer default 0,
  owned_colors text[] default array['#55efc4','#74b9ff','#a29bfe','#fd79a8','#ffeaa7'],
  owned_sparkles text[] default array['none'],
  owned_charms text[] default array['none'],
  created_at timestamp with time zone default now()
);

-- Slimes table
create table slimes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  color text not null,
  sparkle text default 'none',
  charm text default 'none',
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table profiles enable row level security;
alter table slimes enable row level security;

-- Profiles: anyone can view, only you can edit yours
create policy "Anyone can view profiles" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Slimes: anyone can view, only you can manage yours
create policy "Anyone can view slimes" on slimes for select using (true);
create policy "Users can insert own slimes" on slimes for insert with check (auth.uid() = user_id);
create policy "Users can update own slimes" on slimes for update using (auth.uid() = user_id);
create policy "Users can delete own slimes" on slimes for delete using (auth.uid() = user_id);

-- Auto-create a profile when a new user signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
