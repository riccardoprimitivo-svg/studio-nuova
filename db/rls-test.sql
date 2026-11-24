-- Verifica dell'isolamento tra due professionisti di prova. Termina con errore al primo controllo non superato.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

insert into auth.users (id) values (:'A'), (:'B');
insert into public.professionals (id) values (:'A'), (:'B');

create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'NON SUPERATO: %', label; end if;
  raise notice 'ok: %', label;
end $$;

create function pg_temp.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (rifiutato: %)', label, sqlerrm;
    return;
  end;
  raise exception 'NON SUPERATO: % (doveva essere rifiutato)', label;
end $$;

-- ---- A scrive i propri dati
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
insert into public.vaults (professional_id, kdf, by_passphrase, by_recovery)
  values (:'A', '{}', '{"iv":"x","ct":"y"}', '{"iv":"x","ct":"y"}');
insert into public.records (id, professional_id, kind, iv, ct)
  values ('aaaaaaaa-0000-0000-0000-000000000001', :'A', 'person', 'AAAAAAAAAAAA', 'blocco-cifrato-di-A');
insert into public.portal_shares (id, professional_id, email_hash, iv, ct)
  values ('aaaaaaaa-0000-0000-0000-0000000000f1', :'A', 'hash-email', 'AAAAAAAAAAAA', 'pacchetto-di-A');
select pg_temp.expect('A legge i propri record', (select count(*) from public.records) = 1);
select pg_temp.expect('A legge il proprio vault', (select count(*) from public.vaults) = 1);

-- ---- B non vede nulla di A
select set_config('request.jwt.claim.sub', :'B', false);
select pg_temp.expect('B non vede i record di A', (select count(*) from public.records) = 0);
select pg_temp.expect('B non vede il vault di A', (select count(*) from public.vaults) = 0);
select pg_temp.expect('B non vede i pacchetti portale di A', (select count(*) from public.portal_shares) = 0);
select pg_temp.expect('B non vede il profilo di A', (select count(*) from public.professionals where id = :'A') = 0);

-- B non può scrivere al posto di A
select pg_temp.fails('B non inserisce record intestati ad A',
  format($$insert into public.records (id, professional_id, kind, iv, ct) values (gen_random_uuid(), %L, 'person', 'AAAAAAAAAAAA', 'x')$$, :'A'));
select pg_temp.fails('B non inserisce un vault per A',
  format($$insert into public.vaults (professional_id, kdf, by_passphrase, by_recovery) values (%L, '{}', '{}', '{}')$$, :'A'));
with u as (update public.records set ct = 'manomesso' where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1)
  select pg_temp.expect('B non modifica record di A', (select count(*) from u) = 0);
with d as (delete from public.records where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1)
  select pg_temp.expect('B non cancella record di A', (select count(*) from d) = 0);
with u as (update public.portal_shares set revoked_at = now() returning 1)
  select pg_temp.expect('B non revoca pacchetti di A', (select count(*) from u) = 0);

-- B scrive i propri dati e A non li vede
insert into public.records (id, professional_id, kind, iv, ct)
  values ('bbbbbbbb-0000-0000-0000-000000000001', :'B', 'person', 'AAAAAAAAAAAA', 'blocco-cifrato-di-B');
select pg_temp.expect('B vede solo il proprio record', (select count(*) from public.records) = 1);
select set_config('request.jwt.claim.sub', :'A', false);
select pg_temp.expect('A non vede i record di B', (select count(*) from public.records where ct = 'blocco-cifrato-di-B') = 0);

-- ---- A non può cedere un proprio record a B né ignorare i vincoli
select pg_temp.fails('A non cambia il proprietario di un record',
  format($$update public.records set professional_id = %L where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, :'B'));
select pg_temp.fails('tipo di record non ammesso',
  format($$insert into public.records (id, professional_id, kind, iv, ct) values (gen_random_uuid(), %L, 'audio', 'AAAAAAAAAAAA', 'x')$$, :'A'));

-- ---- versione e data le gestisce il server
update public.records set ct = 'blocco-aggiornato', rev = 999, updated_at = '2000-01-01'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.expect('rev incrementata dal server, non dal client',
  (select rev from public.records where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2);
select pg_temp.expect('updated_at impostata dal server',
  (select updated_at from public.records where id = 'aaaaaaaa-0000-0000-0000-000000000001') > '2020-01-01');

-- ---- chi non è autenticato non vede nulla; lo schema private è chiuso
reset role;
set role anon;
select pg_temp.fails('anon non legge i record', 'select * from public.records');
select pg_temp.fails('anon non legge i vault', 'select * from public.vaults');
select pg_temp.fails('anon non legge i pacchetti portale', 'select * from public.portal_shares');
reset role;
set role authenticated;
select pg_temp.fails('authenticated non legge i codici di accesso', 'select * from private.portal_otps');

-- ---- cancellazione a cascata (cancellazione dell'account in autonomia)
reset role;
delete from auth.users where id = :'A';
select pg_temp.expect('cancellando A spariscono tutti i suoi dati',
  (select count(*) from public.records where professional_id = :'A') = 0
  and (select count(*) from public.vaults where professional_id = :'A') = 0
  and (select count(*) from public.portal_shares where professional_id = :'A') = 0);
select pg_temp.expect('i dati di B restano', (select count(*) from public.records where professional_id = :'B') = 1);
