-- =====================================================================
-- Mørvika Hytteområde · Gjøremål
--
-- Hver bruker kan legge inn gjøremål med dato og klokkeslett og få
-- påminnelse på push. Et gjøremål kan være bare for meg selv, eller
-- delt med de andre eierne av hytta (følger eierperioden, så nye eiere
-- ser ikke forrige eiers gjøremål).
--   * Påminnelse ved tidspunktet eller i forkant (15 min, 1 time, 1 dag, 1 uke)
--   * Gjenta: daglig, ukentlig, månedlig, årlig. Når et gjentakende
--     gjøremål krysses av, legges neste gang inn automatisk.
--   * «Påminn igjen til det er gjort»: hver time eller hver dag
--   * Utsett: påminnelsen flyttes (gjøres i appen)
-- En planlagt jobb sjekker hvert minutt og sender påminnelser via Edge Function «push».
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create extension if not exists pg_cron;

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  created_by         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  cabin_id           uuid references public.cabins (id) on delete cascade,        -- satt = delt med eierne
  ownership_id       uuid references public.ownerships (id) on delete cascade,
  title              text not null check (length(trim(title)) between 1 and 200),
  note               text not null default '',
  due_at             timestamptz not null,
  remind_before_min  int not null default 0 check (remind_before_min between 0 and 20160),
  repeat             text not null default 'ingen' check (repeat in ('ingen', 'daglig', 'ukentlig', 'maanedlig', 'aarlig')),
  nag_min            int check (nag_min in (60, 1440)),                           -- påminn igjen til det er gjort
  next_remind_at     timestamptz,
  last_reminded_at   timestamptz,
  done_at            timestamptz,
  done_by            uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index tasks_due on public.tasks (next_remind_at) where done_at is null and next_remind_at is not null;
create index on public.tasks (created_by);
create index on public.tasks (ownership_id);

-- Gjentakende gjøremål: når det krysses av, legges neste gang inn
create function public.tasks_repeat()
returns trigger language plpgsql security definer set search_path = public as $$
declare step interval; nxt timestamptz;
begin
  if new.repeat = 'ingen' or new.done_at is null or old.done_at is not null then return null; end if;
  step := case new.repeat when 'daglig' then interval '1 day' when 'ukentlig' then interval '7 days'
                          when 'maanedlig' then interval '1 month' else interval '1 year' end;
  -- Regnes i norsk tid, så klokkeslettet står fast også over sommertid/vintertid
  nxt := ((new.due_at at time zone 'Europe/Oslo') + step) at time zone 'Europe/Oslo';
  while nxt < now() loop
    nxt := ((nxt at time zone 'Europe/Oslo') + step) at time zone 'Europe/Oslo';
  end loop;
  -- Ikke dobbelt hvis noen krysser av, fjerner krysset og krysser av igjen
  if exists (select 1 from public.tasks where created_by = new.created_by and title = new.title and due_at = nxt and done_at is null) then
    return null;
  end if;
  insert into public.tasks (created_by, cabin_id, ownership_id, title, note, due_at, remind_before_min, repeat, nag_min)
  values (new.created_by, new.cabin_id, new.ownership_id, new.title, new.note, nxt, new.remind_before_min, new.repeat, new.nag_min);
  return null;
end;
$$;
create trigger tasks_repeat after update of done_at on public.tasks for each row execute function public.tasks_repeat();

-- Delte gjøremål knyttes til hyttas nåværende eierperiode. Første påminnelse regnes ut her.
-- (Når tasks_repeat legger inn neste gang, er eierperioden allerede satt.)
create function public.tasks_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.cabin_id is not null and new.ownership_id is null then
      select p.id into new.ownership_id
        from public.ownerships p join public.cabins c on c.id = p.cabin_id
        join public.cabin_owners o on o.ownership_id = p.id
       where p.cabin_id = new.cabin_id and p.ends_on is null and c.access = 'full' and o.user_id = auth.uid()
       limit 1;
      if new.ownership_id is null then
        raise exception 'Du kan bare dele gjøremål med eierne av din egen hytte' using errcode = '42501';
      end if;
    elsif new.cabin_id is null then
      new.ownership_id := null;
    end if;
  else
    new.cabin_id := old.cabin_id; new.ownership_id := old.ownership_id; new.created_by := old.created_by;
  end if;
  if tg_op = 'INSERT' or new.due_at is distinct from old.due_at or new.remind_before_min is distinct from old.remind_before_min then
    new.next_remind_at := new.due_at - make_interval(mins => new.remind_before_min);
    if new.next_remind_at < now() - interval '2 minutes' then
      new.next_remind_at := case when new.due_at > now() then new.due_at end;
    end if;
  end if;
  if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
    new.done_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger tasks_fill before insert or update on public.tasks for each row execute function public.tasks_fill();

alter table public.tasks enable row level security;
create policy "se gjøremål" on public.tasks for select to authenticated using (
  created_by = auth.uid() or (ownership_id is not null and public.can_write_ownership(ownership_id)));
create policy "lage gjøremål" on public.tasks for insert to authenticated with check (
  created_by = auth.uid() and (ownership_id is null or public.can_write_ownership(ownership_id)));
create policy "endre gjøremål" on public.tasks for update to authenticated
  using (created_by = auth.uid() or (ownership_id is not null and public.can_write_ownership(ownership_id)))
  with check (created_by = auth.uid() or (ownership_id is not null and public.can_write_ownership(ownership_id)));
create policy "slette gjøremål" on public.tasks for delete to authenticated using (
  created_by = auth.uid() or (ownership_id is not null and public.can_write_ownership(ownership_id)));
grant select, insert, update, delete on public.tasks to authenticated;

-- ---------------------------------------------------------------------
-- Påminnelser
-- ---------------------------------------------------------------------
create table public.task_reminders (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.tasks (id) on delete cascade,
  sent_at  timestamptz not null default now()
);
alter table public.task_reminders enable row level security;   -- ingen regler: bare databasen og tjenesten

-- Hvert minutt: finn gjøremål som skal minnes om, og send push
create function public.send_task_reminders()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare t record; rid uuid; n int := 0;
begin
  for t in select id, due_at, next_remind_at, nag_min from public.tasks
            where done_at is null and next_remind_at is not null and next_remind_at <= now()
            order by next_remind_at limit 200 for update skip locked loop
    insert into public.task_reminders (task_id) values (t.id) returning id into rid;
    update public.tasks set last_reminded_at = now(),
      next_remind_at = case
        when t.next_remind_at < t.due_at - interval '1 minute' and t.due_at > now() then t.due_at   -- varslet i forkant: varsle igjen ved tidspunktet
        when t.nag_min is not null then now() + make_interval(mins => t.nag_min)                  -- påminn igjen til det er gjort
      end
     where id = t.id;
    begin
      perform net.http_post(
        url     := 'https://eumareoqjwhkgpbporpm.supabase.co/functions/v1/push',
        body    := jsonb_build_object('table', 'task_reminders', 'id', rid),
        headers := '{"Content-Type": "application/json"}'::jsonb);
    exception when others then null;
    end;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.send_task_reminders() from anon, authenticated, public;

-- Push-innhold for en påminnelse (kalles fra push_targets)
create function public.task_reminder_targets(p_reminder uuid)
returns table (user_id uuid, title text, body text, url text, tag text, urgent boolean)
language sql stable security definer set search_path = public as $$
  select u.uid,
         'Gjøremål: ' || t.title,
         case when t.due_at <= now() + interval '1 minute' then 'Nå' else
           'Frist ' || to_char(t.due_at at time zone 'Europe/Oslo', 'DD.MM. "kl." HH24:MI') end
           || coalesce(nullif(' · ' || left(t.note, 120), ' · '), ''),
         '/#gjoremal', 'gjoremal-' || t.id::text, false
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    cross join lateral (
      select t.created_by as uid where t.ownership_id is null
      union
      select o.user_id from public.cabin_owners o where t.ownership_id is not null and o.ownership_id = t.ownership_id
    ) u
   where r.id = p_reminder and r.sent_at > now() - interval '10 minutes' and t.done_at is null;
$$;
revoke all on function public.task_reminder_targets(uuid) from anon, authenticated, public;

-- push_targets får en gren for påminnelser (resten er uendret)
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

  if p_table = 'task_reminders' then
    return query select * from public.task_reminder_targets(p_id);

  elsif p_table = 'alerts' then
    select * into al from public.alerts where id = p_id and created_at > now() - interval '10 minutes';
    if al.id is null then return; end if;
    sender_label := public.sender_name(al.sender);
    return query
      select x.user_id,
             case al.level when 'akutt' then 'AKUTT: ' when 'viktig' then 'Viktig: ' else '' end || al.title,
             sender_label || coalesce(nullif(': ' || left(al.body, 160), ': '), ''),
             '/#varsler', 'varsel-' || al.id::text, al.level = 'akutt'
        from public.audience_members(al.sender, al.audience, al.streets) x
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

select cron.schedule('gjoremal-paaminnelse', '* * * * *', 'select public.send_task_reminders()');
