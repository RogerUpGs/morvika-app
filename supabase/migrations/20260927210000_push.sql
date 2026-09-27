-- =====================================================================
-- Mørvika Hytteområde · Push-varsler til telefonen
--
-- Når noe nytt lagres (varsel, nyhet, melding, kommentar), sender
-- databasen et lite signal til Edge Function «push» med tabellnavn og id.
-- Funksjonen spør databasen hvem som skal ha varsel (push_targets) og
-- sender til telefonene deres.
--
-- Signalet inneholder bare tabell og id. push_targets gir bare svar for
-- rader som er nye (under 10 minutter) og ikke varslet før, så et
-- falskt signal kan ikke brukes til å sende noe.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- Innstillinger som appen trenger (den offentlige push-nøkkelen)
-- ---------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "alle innloggede leser innstillinger" on public.app_settings for select to authenticated using (true);
create policy "admin endrer innstillinger" on public.app_settings for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
grant select, insert, update, delete on public.app_settings to authenticated;

-- ---------------------------------------------------------------------
-- Lagre push-abonnement for denne telefonen/PC-en.
-- Samme nettleser kan ha vært brukt av en annen person før: da flyttes den.
-- ---------------------------------------------------------------------
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_agent, 300))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from anon, public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Hvem er med i en mottakergruppe (hytteeiere med konto)
-- ---------------------------------------------------------------------
create function public.audience_members(s public.sender, a public.audience)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select distinct o.user_id
    from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
   where (c.access = 'full' or (s = 'vei' and c.vei_member))
     and case a
           when 'alle'    then true
           when 'morvika' then c.area = 'morvika'
           when 'torpum'  then c.area = 'torpum'
           when 'vel'     then c.vel_member
           when 'vei'     then c.vei_member
         end;
$$;
revoke all on function public.audience_members(public.sender, public.audience) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Hvem skal ha push, og hva skal stå i varselet
-- ---------------------------------------------------------------------
create table public.push_log (
  table_name text not null,
  record_id  uuid not null,
  sent_at    timestamptz not null default now(),
  primary key (table_name, record_id)
);
alter table public.push_log enable row level security;   -- ingen regler: bare tjenesten ser den

create function public.push_targets(p_table text, p_id uuid)
returns table (user_id uuid, title text, body text, url text, tag text, urgent boolean)
language plpgsql security definer set search_path = public as $$
declare
  sender_label text; n int;
  al public.alerts; nw public.news; m public.messages; t public.threads; cm public.post_comments; p public.posts;
  who text;
begin
  -- Bare én gang per rad
  insert into public.push_log (table_name, record_id) values (p_table, p_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;

  if p_table = 'alerts' then
    select * into al from public.alerts where id = p_id and created_at > now() - interval '10 minutes';
    if al.id is null then return; end if;
    sender_label := case al.sender when 'grunneier' then 'Grunneier' when 'vel' then 'Mørvika Vel' when 'vei' then 'Mørvikveien Veilag' else 'Administrator' end;
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
    sender_label := case nw.sender when 'grunneier' then 'grunneier' when 'vel' then 'Mørvika Vel' when 'vei' then 'Mørvikveien Veilag' else 'administrator' end;
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
          -- Svar til hytteeieren
          select t.owner_id as uid where m.author_id <> t.owner_id
          union
          -- Ny melding fra hytteeieren til grunneier eller et styre
          select ur.user_id from public.user_roles ur
           where m.author_id = t.owner_id
             and (ur.role = 'grunneier'
                  or (t.recipient = 'vel' and ur.role = 'styre_vel')
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
  end if;
end;
$$;
revoke all on function public.push_targets(text, uuid) from anon, authenticated, public;
grant execute on function public.push_targets(text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Signal til Edge Function når noe nytt lagres
-- ---------------------------------------------------------------------
create function public.notify_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform net.http_post(
      url     := 'https://eumareoqjwhkgpbporpm.supabase.co/functions/v1/push',
      body    := jsonb_build_object('table', tg_table_name, 'id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    null;  -- Et varsel som ikke går ut, skal aldri stoppe selve lagringen
  end;
  return new;
end;
$$;

create trigger push_alert   after insert on public.alerts        for each row execute function public.notify_push();
create trigger push_news    after insert on public.news          for each row execute function public.notify_push();
create trigger push_message after insert on public.messages      for each row execute function public.notify_push();
create trigger push_comment after insert on public.post_comments for each row execute function public.notify_push();
