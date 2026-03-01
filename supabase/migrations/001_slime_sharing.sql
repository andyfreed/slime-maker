-- ============================================================
-- SLIME SHARING - Share codes + favorites
-- Run this AFTER setup.sql
-- ============================================================

-- Share codes table
create table if not exists slime_shares (
  id uuid default gen_random_uuid() primary key,
  slime_id uuid references slimes(id) on delete cascade not null,
  share_code text unique not null,
  created_by_profile_id uuid references profiles(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default (now() + interval '30 days'),
  view_count integer default 0,
  is_revoked boolean default false
);

-- Favorites table
create table if not exists slime_favorites (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid references profiles(id) on delete cascade not null,
  slime_id uuid references slimes(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  unique (profile_id, slime_id)
);

-- Enable RLS
alter table slime_shares enable row level security;
alter table slime_favorites enable row level security;

-- Shares policies:
-- Users can create shares only for slimes they own
create policy "Users can create shares for own slimes"
  on slime_shares for insert
  with check (
    auth.uid() = created_by_profile_id
    and exists (
      select 1 from slimes where slimes.id = slime_id and slimes.user_id = auth.uid()
    )
  );

-- Users can view their own shares
create policy "Users can view own shares"
  on slime_shares for select
  using (auth.uid() = created_by_profile_id);

-- Users can revoke their own shares
create policy "Users can update own shares"
  on slime_shares for update
  using (auth.uid() = created_by_profile_id);

-- Users can delete their own shares
create policy "Users can delete own shares"
  on slime_shares for delete
  using (auth.uid() = created_by_profile_id);

-- Favorites policies:
create policy "Users can view own favorites"
  on slime_favorites for select
  using (auth.uid() = profile_id);

create policy "Users can add favorites"
  on slime_favorites for insert
  with check (auth.uid() = profile_id);

create policy "Users can remove favorites"
  on slime_favorites for delete
  using (auth.uid() = profile_id);

-- RPC: Create a share code for a slime you own
-- Returns the share code
create or replace function create_slime_share(p_slime_id uuid, p_share_code text)
returns text
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Verify ownership
  if not exists (
    select 1 from slimes where id = p_slime_id and user_id = v_user_id
  ) then
    raise exception 'You do not own this slime';
  end if;

  -- Insert share
  insert into slime_shares (slime_id, share_code, created_by_profile_id)
  values (p_slime_id, p_share_code, v_user_id);

  return p_share_code;
end;
$$;

-- RPC: Get shared slime by code (safe: returns only display fields, no owner ids)
create or replace function get_shared_slime(p_share_code text)
returns json
language plpgsql
security definer
as $$
declare
  v_result json;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select json_build_object(
    'id', s.id,
    'name', s.name,
    'color', s.color,
    'sparkle', s.sparkle,
    'charm', s.charm,
    'share_code', sh.share_code,
    'creator_name', p.username
  )
  into v_result
  from slime_shares sh
  join slimes s on s.id = sh.slime_id
  join profiles p on p.id = sh.created_by_profile_id
  where sh.share_code = p_share_code
    and sh.is_revoked = false
    and (sh.expires_at is null or sh.expires_at > now());

  if v_result is null then
    raise exception 'Share code not found or expired';
  end if;

  -- Increment view count
  update slime_shares set view_count = view_count + 1
  where share_code = p_share_code;

  return v_result;
end;
$$;
