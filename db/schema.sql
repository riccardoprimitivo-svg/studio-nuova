-- Schema multi-professionista con dati cifrati end-to-end.
-- Bozza per Supabase: usa auth.uid() e i ruoli anon/authenticated.
-- Il server non conosce il contenuto: nomi, appunti, importi e relazioni stanno dentro i blocchi cifrati.

create schema if not exists private;

-- Un professionista = un utente di Supabase Auth.
create table public.professionals (
  id                uuid primary key references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  -- accettazione in app di termini e DPA, con versione e data (niente PDF firmati a mano)
  terms_version     text,
  terms_accepted_at timestamptz,
  privacy_version   text,
  privacy_accepted_at timestamptz,
  dpa_version       text,
  dpa_accepted_at   timestamptz
);

-- Chiave principale avvolta con passphrase e con chiave di recupero. Il server non può aprirla.
create table public.vaults (
  professional_id uuid primary key references public.professionals (id) on delete cascade,
  kdf             jsonb not null,
  by_passphrase   jsonb not null,
  by_recovery     jsonb not null,
  updated_at      timestamptz not null default now()
);

-- Tutti i dati di lavoro: persone, incontri, pacchetti, strutture, pagamenti, impostazioni.
-- Il tipo è in chiaro (serve alla sincronizzazione); tutto il resto è nel blocco cifrato.
create table public.records (
  id              uuid primary key,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  kind            text not null check (kind in ('person','meeting','package','structure','payment','setting','share_key')),
  iv              text not null check (length(iv) between 8 and 64),
  ct              text not null check (length(ct) <= 1500000),
  rev             integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index records_sync_idx on public.records (professional_id, updated_at);

-- Pacchetto visibile alla persona, cifrato con la chiave di condivisione di quella persona.
-- L'email è conservata solo come impronta (HMAC con segreto del server).
create table public.portal_shares (
  id              uuid primary key,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  email_hash      text not null,
  iv              text not null,
  ct              text not null check (length(ct) <= 1500000),
  rev             integer not null default 1,
  revoked_at      timestamptz,
  updated_at      timestamptz not null default now()
);
create index portal_shares_owner_idx on public.portal_shares (professional_id);
create index portal_shares_email_idx on public.portal_shares (email_hash);

-- Codici di accesso monouso della persona. Nessun accesso diretto: solo la funzione edge (service role).
create table private.portal_otps (
  id         bigint generated always as identity primary key,
  share_id   uuid not null references public.portal_shares (id) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   integer not null default 0,
  used_at    timestamptz
);
create index portal_otps_share_idx on private.portal_otps (share_id);

-- Versione e data di modifica gestite dal server, non dal client.
create function private.bump_rev() returns trigger language plpgsql set search_path = '' as $$
begin
  new.rev := old.rev + 1;
  new.updated_at := now();
  return new;
end $$;

create trigger records_bump before update on public.records
  for each row execute function private.bump_rev();
create trigger portal_shares_bump before update on public.portal_shares
  for each row execute function private.bump_rev();

-- Il proprietario di un record non può mai cambiare.
create function private.keep_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.professional_id is distinct from old.professional_id then
    raise exception 'professional_id non modificabile';
  end if;
  return new;
end $$;

create trigger records_keep_owner before update on public.records
  for each row execute function private.keep_owner();
create trigger portal_shares_keep_owner before update on public.portal_shares
  for each row execute function private.keep_owner();

-- Sicurezza a livello di riga: ognuno vede e modifica solo le proprie righe.
alter table public.professionals  enable row level security;
alter table public.vaults         enable row level security;
alter table public.records        enable row level security;
alter table public.portal_shares  enable row level security;
alter table private.portal_otps   enable row level security;

create policy professionals_own on public.professionals
  for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy vaults_own on public.vaults
  for all to authenticated
  using (professional_id = (select auth.uid())) with check (professional_id = (select auth.uid()));

create policy records_own on public.records
  for all to authenticated
  using (professional_id = (select auth.uid())) with check (professional_id = (select auth.uid()));

create policy portal_shares_own on public.portal_shares
  for all to authenticated
  using (professional_id = (select auth.uid())) with check (professional_id = (select auth.uid()));

-- Permessi: nessuno per anon; il minimo per authenticated; niente sullo schema private.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.professionals, public.vaults, public.records, public.portal_shares
  to authenticated;
revoke all on schema private from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
