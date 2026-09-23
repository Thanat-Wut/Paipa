-- Supabase auto-grants EXECUTE to anon on newly created public functions.
-- The core migration's REVOKE FROM PUBLIC does not remove that explicit grant.
revoke execute on function public.create_trip(text,text,text,date,date,numeric,integer) from anon;
revoke execute on function public.join_trip(text,text,text,text,text) from anon;
revoke execute on function public.update_member_profile(uuid,text,text,text,text,text) from anon;
revoke execute on function public.leave_trip(uuid) from anon;

-- preview_invite is intentionally accessible to anonymous visitors holding an invite code.
