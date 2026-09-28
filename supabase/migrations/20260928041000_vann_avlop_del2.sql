-- =====================================================================
-- Mørvika Hytteområde · Mørvika Vann og Avløp, del 2 av 2
--
-- Kjøres etter del 1. Gir Vann og avløp det samme som Velet har:
--   * medlemskap per hytte (va_member). Alle hytter på Mørvika settes
--     som medlem nå. Torpum er ikke med.
--   * styret (rollen «Styret VA») og grunneier kan publisere nyheter,
--     varsler, arrangementer og dokumenter som «Mørvika Vann og Avløp»
--   * hytteeiere kan sende meldinger til styret. Grunneier leser dem også.
--   * egne kontakter under Info
--   * push til medlemmene
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Medlemskap
-- ---------------------------------------------------------------------
alter table public.cabins add column va_member boolean not null default false;
update public.cabins set va_member = true where area = 'morvika';

-- ---------------------------------------------------------------------
-- Hvem kan publisere og ta imot meldinger
-- ---------------------------------------------------------------------
create or replace function public.can_send_as(s public.sender)
returns boolean language sql stable security definer set search_path = public as $$
  select case s
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.has_role('styre_vel') or public.has_role('grunneier')
    when 'va'        then public.has_role('styre_va')  or public.has_role('grunneier')
    when 'vei'       then public.has_role('styre_vei') or public.has_role('grunneier')
    when 'admin'     then public.has_role('admin')
  end;
$$;

create or replace function public.handles_recipient(r public.recipient)
returns boolean language sql stable security definer set search_path = public as $$
  select case r
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.has_role('styre_vel') or public.has_role('grunneier')
    when 'va'        then public.has_role('styre_va')  or public.has_role('grunneier')
    when 'vei'       then public.has_role('styre_vei') or public.has_role('grunneier')
  end;
$$;

create or replace function public.can_publish_in(folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select folder in ('grunneier', 'vel', 'va', 'vei', 'admin') and public.can_send_as(folder::public.sender);
$$;

-- ---------------------------------------------------------------------
-- Mottakergrupper
-- ---------------------------------------------------------------------
create or replace function public.in_audience(a public.audience)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or case a
    when 'alle'    then exists (select 1 from public.cabin_owners where user_id = auth.uid())
                        or exists (select 1 from public.user_roles where user_id = auth.uid())
    when 'morvika' then exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                                where o.user_id = auth.uid() and c.area = 'morvika')
    when 'torpum'  then exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                                where o.user_id = auth.uid() and c.area = 'torpum')
    when 'vel'     then public.has_role('styre_vel') or exists (
                          select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                          where o.user_id = auth.uid() and c.vel_member)
    when 'va'      then public.has_role('styre_va') or exists (
                          select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                          where o.user_id = auth.uid() and c.va_member)
    when 'vei'     then public.has_role('styre_vei') or exists (
                          select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                          where o.user_id = auth.uid() and c.vei_member)
  end;
$$;

create or replace function public.audience_size(a public.audience)
returns int language sql stable security definer set search_path = public as $$
  select case when not (public.is_staff() or public.has_role('styre_vel') or public.has_role('styre_va') or public.has_role('styre_vei')) then null
  else (
    select count(distinct o.user_id)::int
    from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
    where case a
      when 'alle'    then c.access = 'full'
      when 'morvika' then c.area = 'morvika'
      when 'torpum'  then c.area = 'torpum'
      when 'vel'     then c.vel_member
      when 'va'      then c.va_member
      when 'vei'     then c.vei_member
    end
  ) end;
$$;

create or replace function public.audience_members(s public.sender, a public.audience)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select distinct o.user_id
    from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
   where (c.access = 'full' or (s = 'vei' and c.vei_member))
     and case a
           when 'alle'    then true
           when 'morvika' then c.area = 'morvika'
           when 'torpum'  then c.area = 'torpum'
           when 'vel'     then c.vel_member
           when 'va'      then c.va_member
           when 'vei'     then c.vei_member
         end;
$$;

create or replace function public.alert_recipients(p_alert uuid)
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
             when 'va'      then c.va_member
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

-- ---------------------------------------------------------------------
-- Push: avsendernavn og meldinger til VA-styret
-- ---------------------------------------------------------------------
create or replace function public.sender_name(s public.sender)
returns text language sql immutable set search_path = public as $$
  select case s when 'grunneier' then 'Grunneier' when 'vel' then 'Mørvika Vel' when 'va' then 'Mørvika Vann og Avløp'
                when 'vei' then 'Mørvikveien Veilag' else 'Administrator' end;
$$;

create or replace function public.push_targets(p_table text, p_id uuid)
returns table (user_id uuid, title text, body text, url text, tag text, urgent boolean)
language plpgsql security definer set search_path = public as $$
declare
  sender_label text; n int; tid text;
  al public.alerts; nw public.news; m public.messages; t public.threads; cm public.post_comments; p public.posts; ev public.events;
  who text;
begin
  -- Bare én gang per rad
  insert into public.push_log (table_name, record_id) values (p_table, p_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;

  if p_table = 'alerts' then
    select * into al from public.alerts where id = p_id and created_at > now() - interval '10 minutes';
    if al.id is null then return; end if;
    sender_label := public.sender_name(al.sender);
    return query
      select x.user_id,
             case al.level when 'akutt' then 'AKUTT: ' when 'viktig' then 'Viktig: ' else '' end || al.title,
             sender_label || coalesce(nullif(': ' || left(al.body, 160), ': '), ''),
             '/#varsler', 'varsel-' || al.id::text, al.level = 'akutt'
        from public.audience_members(al.sender, al.audience) x
       where x.user_id is distinct from al.created_by;

  elsif p_table = 'news' then
    select * into nw from public.news where id = p_id and notify and created_at > now() - interval '10 minutes';
    if nw.id is null then return; end if;
    sender_label := case nw.sender when 'grunneier' then 'grunneier' when 'admin' then 'administrator' else public.sender_name(nw.sender) end;
    return query
      select x.user_id, 'Nytt fra ' || sender_label, nw.title, '/#nyheter', 'nyhet-' || nw.id::text, false
        from public.audience_members(nw.sender, nw.audience) x
        left join public.notification_prefs np on np.user_id = x.user_id
       where x.user_id is distinct from nw.created_by and coalesce(np.news, true);

  elsif p_table = 'messages' then
    select * into m from public.messages where id = p_id and created_at > now() - interval '10 minutes';
    if m.id is null then return; end if;
    select * into t from public.threads where id = m.thread_id;
    select coalesce(nullif(full_name, ''), 'Ny melding') into who from public.profiles where id = m.author_id;
    return query
      select r.uid, who, t.subject || ': ' || coalesce(nullif(left(m.body, 140), ''), 'Bilde'),
             '/#meldinger', 'samtale-' || t.id::text, false
        from (
          select t.owner_id as uid where m.author_id <> t.owner_id
          union
          select ur.user_id from public.user_roles ur
           where m.author_id = t.owner_id
             and (ur.role = 'grunneier'
                  or (t.recipient = 'vel' and ur.role = 'styre_vel')
                  or (t.recipient = 'va'  and ur.role = 'styre_va')
                  or (t.recipient = 'vei' and ur.role = 'styre_vei'))
        ) r
        left join public.notification_prefs np on np.user_id = r.uid
       where r.uid <> m.author_id and coalesce(np.messages, true);

  elsif p_table = 'post_comments' then
    select * into cm from public.post_comments where id = p_id and created_at > now() - interval '10 minutes';
    if cm.id is null then return; end if;
    select * into p from public.posts where id = cm.post_id;
    select coalesce(nullif(full_name, ''), 'Noen') into who from public.profiles where id = cm.author_id;
    return query
      select p.author_id, who || ' kommenterte innlegget ditt', left(cm.body, 160), '/#chat', 'innlegg-' || p.id::text, false
        from public.profiles pr
        left join public.notification_prefs np on np.user_id = pr.id
       where pr.id = p.author_id and p.author_id <> cm.author_id and coalesce(np.praten, true);

  elsif p_table = 'events' then
    select * into ev from public.events where id = p_id and notify and created_at > now() - interval '10 minutes';
    if ev.id is null then return; end if;
    tid := to_char(ev.starts_at at time zone 'Europe/Oslo', 'DD.MM. "kl." HH24:MI');
    return query
      select x.user_id, 'Nytt arrangement: ' || ev.title, tid || coalesce(nullif(' · ' || ev.place, ' · '), ''),
             '/#arr', 'arr-' || ev.id::text, false
        from public.audience_members(ev.organizer, ev.audience) x
        left join public.notification_prefs np on np.user_id = x.user_id
       where x.user_id is distinct from ev.created_by and coalesce(np.events, true);

  elsif p_table = 'event_reminder' then
    -- Påminnelse til de påmeldte når arrangementet er i morgen
    select * into ev from public.events where id = p_id and starts_at between now() + interval '6 hours' and now() + interval '36 hours';
    if ev.id is null then return; end if;
    tid := to_char(ev.starts_at at time zone 'Europe/Oslo', '"kl." HH24:MI');
    return query
      select a.user_id, 'I morgen: ' || ev.title, tid || coalesce(nullif(' · ' || ev.place, ' · '), '') || '. Du er påmeldt.',
             '/#arr', 'arr-' || ev.id::text, false
        from public.event_attendees a
       where a.event_id = ev.id;
  end if;
end;
$$;
revoke all on function public.push_targets(text, uuid) from anon, authenticated, public;
grant execute on function public.push_targets(text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Kontakter (Info)
-- ---------------------------------------------------------------------
alter table public.contacts drop constraint if exists contacts_grp_check;
alter table public.contacts add constraint contacts_grp_check check (grp in ('grunneier', 'vel', 'va', 'vei', 'nyttig'));

create or replace function public.can_edit_contacts(g text)
returns boolean language sql stable security definer set search_path = public as $$
  select case g
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.can_send_as('vel')
    when 'va'        then public.can_send_as('va')
    when 'vei'       then public.can_send_as('vei')
    when 'nyttig'    then public.is_staff()
    else false end;
$$;
