-- =====================================================================
-- Mørvika Hytteområde · Oversikt over hvem som har sett et varsel
--
-- Avsenderen av et varsel (og alle som kan sende som samme avsender)
-- får en liste over mottakerne:
--   bekreftet    – har trykket «Jeg har sett varselet»
--   venter       – har appen, men har ikke bekreftet ennå
--   ikke_i_appen – registrert som eier, men har aldri logget inn
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create function public.alert_recipients(p_alert uuid)
returns table (person_id uuid, full_name text, cabins text, status text, acked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert;
  if a.id is null then return; end if;
  if not (public.can_send_as(a.sender) or a.created_by = auth.uid()) then
    raise exception 'Bare avsenderen ser hvem som har bekreftet' using errcode = '42501';
  end if;

  return query
  with mottakerhytter as (
    select c.id, c.label, c.number from public.cabins c
     where (c.access = 'full' or (a.sender = 'vei' and c.vei_member))
       and case a.audience
             when 'alle'    then true
             when 'morvika' then c.area = 'morvika'
             when 'torpum'  then c.area = 'torpum'
             when 'vel'     then c.vel_member
             when 'vei'     then c.vei_member
           end
  )
  select p.id, p.full_name,
         string_agg(h.label, ', ' order by h.number),
         case when k.acked_at is null then 'venter' else 'bekreftet' end,
         k.acked_at
    from public.cabin_owners o
    join mottakerhytter h on h.id = o.cabin_id
    join public.profiles p on p.id = o.user_id
    left join public.alert_acks k on k.alert_id = a.id and k.user_id = o.user_id
   where o.user_id is distinct from a.created_by
   group by p.id, p.full_name, k.acked_at
  union all
  select q.id, q.full_name,
         string_agg(h.label, ', ' order by h.number),
         'ikke_i_appen', null::timestamptz
    from public.pending_cabin_owners po
    join mottakerhytter h on h.id = po.cabin_id
    join public.pending_people q on q.id = po.pending_id
   group by q.id, q.full_name;
end;
$$;

revoke all on function public.alert_recipients(uuid) from anon, public;
grant execute on function public.alert_recipients(uuid) to authenticated;
