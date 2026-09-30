-- =====================================================================
-- Mørvika Hytteområde · Prosjektsamtale i adskilte tråder
--
--   * «Kunde»: eier og kjøper. Håndverkerne ser den ikke.
--   * «Håndverker»: én tråd mellom eier og hver håndverker. Kjøperen og
--     de andre håndverkerne ser den ikke.
--   * Eieren kan videresende meldinger (med vedlegg) fra én tråd til en
--     annen. Videresendte meldinger viser hvem som skrev originalen og når.
--   * «Avtalt endring» finnes bare i kundetråden, og bare eieren merker.
--   * Ved overlevering fra utbygger følger bare kundetråden med til kjøper.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

alter table public.project_messages
  add column channel   text not null default 'kunde' check (channel in ('kunde', 'handverker')),
  add column worker_id uuid references public.profiles (id) on delete cascade,
  add column fwd_author text,
  add column fwd_at     timestamptz,
  add column fwd_from   text,
  add constraint project_messages_channel_worker check ((channel = 'handverker') = (worker_id is not null));
create index project_messages_thread on public.project_messages (ownership_id, channel, worker_id, created_at);

-- Rolle på prosjektet i en åpen eierperiode
create function public.project_role(w uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.can_write_ownership(w) then 'eier'
    else (select k.kind from public.ownerships s
            join public.cabins c on c.id = s.cabin_id and c.access = 'full'
            join public.cabin_workers k on k.cabin_id = s.cabin_id and k.user_id = auth.uid()
           where s.id = w and s.ends_on is null)
  end;
$$;

-- Er personen håndverker på prosjektet (brukes når eieren skriver til en håndverker)
create function public.is_project_craftsman(w uuid, u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ownerships s join public.cabin_workers k on k.cabin_id = s.cabin_id
                  where s.id = w and s.ends_on is null and k.user_id = u and k.kind = 'medarbeider');
$$;

-- Hvem kan se en tråd
create function public.can_see_thread(w uuid, ch text, wk uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_ownership(w)
      or (ch = 'kunde' and public.project_role(w) = 'kjoper')
      or (ch = 'handverker' and wk = auth.uid() and public.project_role(w) = 'medarbeider');
$$;

drop policy "les prosjektsamtale" on public.project_messages;
drop policy "skriv i prosjektsamtale" on public.project_messages;
drop policy "slett egen melding" on public.project_messages;

create policy "les prosjektsamtale" on public.project_messages for select to authenticated
  using (public.can_see_thread(ownership_id, channel, worker_id));
create policy "skriv i prosjektsamtale" on public.project_messages for insert to authenticated
  with check (
    author_id = auth.uid() and change_marked_at is null and change_confirmed_at is null
    and public.project_chat_open(ownership_id)
    and (
      -- Eieren skriver i alle tråder (også videresending), til håndverkere som er på prosjektet
      (public.can_write_ownership(ownership_id) and (channel = 'kunde' or public.is_project_craftsman(ownership_id, worker_id)))
      or (fwd_author is null and channel = 'kunde' and public.project_role(ownership_id) = 'kjoper')
      or (fwd_author is null and channel = 'handverker' and worker_id = auth.uid() and public.project_role(ownership_id) = 'medarbeider')
    ));
create policy "slett egen melding" on public.project_messages for delete to authenticated
  using (author_id = auth.uid() and change_marked_at is null and public.project_chat_open(ownership_id)
         and public.can_see_thread(ownership_id, channel, worker_id));

-- Vedlegg: lesepolicyen fra forrige fil gjelder fortsatt (den som ser meldingen, ser vedlegget)

-- Deltakere: eieren ser alle, kjøperen ser eier og kjøpere, håndverkeren ser eier og seg selv
create or replace function public.project_participants(w uuid)
returns table (id uuid, full_name text, role text, active boolean)
language sql stable security definer set search_path = public as $$
  with me as (select public.project_role(w) as r, public.can_read_ownership(w) as own)
  select x.id, x.full_name, x.role, x.active from (
    select p.id, p.full_name, 'eier'::text as role, true as active, 0 as ord
      from public.cabin_owners o join public.profiles p on p.id = o.user_id
     where o.ownership_id = w
    union all
    select p.id, p.full_name, k.kind, true, case k.kind when 'kjoper' then 1 else 2 end
      from public.ownerships s
      join public.cabin_workers k on k.cabin_id = s.cabin_id
      join public.profiles p on p.id = k.user_id
     where s.id = w and s.ends_on is null
    union all
    select q.id, q.full_name, k.kind, false, case k.kind when 'kjoper' then 1 else 2 end
      from public.ownerships s
      join public.pending_cabin_workers k on k.cabin_id = s.cabin_id
      join public.pending_people q on q.id = k.pending_id
     where s.id = w and s.ends_on is null
  ) x, me
  where me.own or me.r is not null
    and (me.own or x.role = 'eier' or (me.r = 'kjoper' and x.role = 'kjoper') or x.id = auth.uid())
  order by x.ord, x.full_name;
$$;

-- «Avtalt endring»: bare i kundetråden, og bare eieren merker
create or replace function public.project_mark_change(p_msg uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.project_messages;
begin
  select * into m from public.project_messages where id = p_msg;
  if m.id is null then raise exception 'Meldingen finnes ikke'; end if;
  if m.channel <> 'kunde' then raise exception 'Avtalte endringer merkes i samtalen med kjøper'; end if;
  if not (public.can_write_ownership(m.ownership_id) and public.project_chat_open(m.ownership_id)) then
    raise exception 'Bare eieren kan merke avtalte endringer' using errcode = '42501';
  end if;
  if m.change_confirmed_at is not null then raise exception 'Endringen er allerede bekreftet av kjøper'; end if;
  update public.project_messages
     set change_marked_at = case when p_on then now() end,
         change_marked_by = case when p_on then auth.uid() end
   where id = p_msg;
end;
$$;

-- Ved overlevering: bare kundetråden følger med til kjøper.
-- Håndverkertrådene blir liggende hos utbyggeren (lesetilgang i fristen etter eierskiftet).
create or replace function public.move_project_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.from_builder then
    update public.project_messages set ownership_id = new.to_ownership
     where ownership_id = new.from_ownership and channel = 'kunde';
  end if;
  return new;
end;
$$;

-- Push: bare til dem som er med i tråden
create or replace function public.push_targets(p_table text, p_id uuid)
returns table (user_id uuid, title text, body text, url text, tag text, urgent boolean)
language plpgsql security definer set search_path = public as $$
declare n int; m public.project_messages; who text; what text;
begin
  if p_table <> 'project_messages' then
    return query select * from public.push_targets_base(p_table, p_id);
    return;
  end if;
  insert into public.push_log (table_name, record_id) values (p_table, p_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;
  select * into m from public.project_messages where id = p_id and created_at > now() - interval '10 minutes';
  if m.id is null then return; end if;
  select coalesce(nullif(full_name, ''), 'Ny melding') into who from public.profiles where id = m.author_id;
  select coalesce(c.project_name, c.label) into what from public.cabins c where c.id = m.cabin_id;
  return query
    select u.uid, 'Prosjektsamtale · ' || what,
           coalesce(who, 'Ny melding') || ': ' || case when m.body <> '' then left(m.body, 160)
             else 'sendte ' || jsonb_array_length(m.attachments) || ' vedlegg' end,
           '/#minhytte', 'prosjekt-' || m.cabin_id::text || '-' || m.channel || coalesce('-' || m.worker_id::text, ''), false
      from (select o.user_id as uid from public.cabin_owners o where o.ownership_id = m.ownership_id
            union
            select k.user_id from public.cabin_workers k
              join public.ownerships w on w.cabin_id = k.cabin_id
             where w.id = m.ownership_id and w.ends_on is null
               and ((m.channel = 'kunde' and k.kind = 'kjoper') or (m.channel = 'handverker' and k.user_id = m.worker_id))) u
     where u.uid is distinct from m.author_id;
end;
$$;

revoke all on function public.push_targets(text, uuid) from anon, authenticated, public;
grant execute on function public.push_targets(text, uuid) to service_role;
revoke all on function public.is_project_craftsman(uuid, uuid), public.project_role(uuid), public.can_see_thread(uuid, text, uuid), public.project_participants(uuid), public.project_mark_change(uuid, boolean) from anon, public;
grant execute on function public.is_project_craftsman(uuid, uuid), public.project_role(uuid), public.can_see_thread(uuid, text, uuid), public.project_participants(uuid), public.project_mark_change(uuid, boolean) to authenticated;
