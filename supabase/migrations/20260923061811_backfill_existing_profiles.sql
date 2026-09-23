-- Accounts created before Paipa's auth trigger still need a profile row.
insert into public.profiles (id, display_name)
select id, left(coalesce(nullif(split_part(email, '@', 1), ''), 'เพื่อนใหม่'), 60)
from auth.users
on conflict (id) do nothing;
