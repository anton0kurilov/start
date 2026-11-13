-- Start owns only these two schemas. Auth, other apps and global defaults
-- deliberately remain untouched. Expose `start` in the project's Data API.
begin;
create schema if not exists start;
create schema if not exists start_private;
revoke all on schema start_private from public, anon, authenticated;
grant usage on schema start to authenticated;

create table start.profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);
create table start_private.accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    epoch bigint not null default 0,
    learning_epoch uuid not null default gen_random_uuid(),
    head bigint not null default 0,
    min_cursor bigint not null default 0
);
-- Typed logical entities share one envelope and one change transport. All
-- content is validated by RPC, with direct client writes revoked below.
create table start.records (
    user_id uuid not null references auth.users(id) on delete cascade,
    account_epoch bigint not null,
    kind text not null check (kind in ('folder','subscription','preference','phrase','read','feedback','event','observation')),
    id text not null check (length(id) between 1 and 256),
    data jsonb not null check (jsonb_typeof(data) = 'object'),
    revision bigint not null,
    deleted boolean not null default false,
    primary key (user_id, kind, id)
);
create index start_records_parent on start.records(user_id, (data->>'folderId')) where kind='subscription' and not deleted;
create index start_records_event on start.records(user_id, (data->>'itemKey'), (data->>'type')) where kind='event' and not deleted;
create table start_private.devices (
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id uuid not null,
    account_epoch bigint not null,
    last_seq bigint not null default 0,
    last_seen_at timestamptz not null default now(),
    primary key (user_id, device_id)
);
create table start_private.learning_profiles (
    user_id uuid not null references auth.users(id) on delete cascade,
    profile_id text not null,
    device_id uuid,
    primary key (user_id, profile_id)
);
create table start_private.changes (
    user_id uuid not null references auth.users(id) on delete cascade,
    account_epoch bigint not null,
    revision bigint not null,
    effects jsonb not null,
    committed_at timestamptz not null default now(),
    primary key (user_id, account_epoch, revision)
);
create table start_private.receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    account_epoch bigint not null,
    device_id uuid not null,
    sequence bigint not null,
    op_id uuid not null,
    request_hash text not null,
    result jsonb not null,
    created_at timestamptz not null default now(),
    primary key (user_id, account_epoch, device_id, sequence),
    unique (user_id, account_epoch, op_id)
);
create table start_private.snapshots (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_epoch bigint not null,
    learning_epoch uuid not null,
    revision bigint not null,
    expires_at timestamptz not null default now() + interval '20 minutes'
);
create index start_snapshots_expiry on start_private.snapshots(expires_at);
create table start_private.snapshot_rows (
    snapshot_id uuid not null references start_private.snapshots(id) on delete cascade,
    position bigint not null,
    entity jsonb not null,
    primary key (snapshot_id, position)
);

alter table start.profiles enable row level security;
alter table start.records enable row level security;
alter table start_private.accounts enable row level security;
alter table start_private.devices enable row level security;
alter table start_private.learning_profiles enable row level security;
alter table start_private.changes enable row level security;
alter table start_private.receipts enable row level security;
alter table start_private.snapshots enable row level security;
alter table start_private.snapshot_rows enable row level security;
create policy own_profile on start.profiles for select to authenticated using (user_id=(select auth.uid()));
create policy own_records on start.records for select to authenticated using (
    user_id=(select auth.uid()) and exists (select 1 from start.profiles p where p.user_id=(select auth.uid()))
);
revoke all on all tables in schema start from public, anon, authenticated;
grant select on start.profiles, start.records to authenticated;

create function start_private.require_user(require_profile boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
    if u is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
    if require_profile and not exists(select 1 from start.profiles where user_id=u) then raise exception 'PROFILE_NOT_FOUND'; end if;
    return u;
end $$;
create function start_private.must(ok boolean, code text default 'INVALID_COMMAND')
returns void language plpgsql set search_path='' as $$
begin if ok is distinct from true then raise exception '%', code; end if; end $$;
create function start_private.hash(value text) returns text language sql immutable set search_path='' as $$
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(value,'UTF8')),'hex')
$$;
create function start_private.item_id(value text) returns text language sql immutable set search_path='' as $$
    select start_private.hash('item-key-v1:' || btrim(value))
$$;
create function start_private.string(value jsonb, name text, maximum integer default 512)
returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
    perform start_private.must(jsonb_typeof(value->name)='string');
    result := btrim(value->>name);
    perform start_private.must(length(result) between 1 and maximum);
    return result;
end $$;
create function start_private.entity(row_value start.records)
returns jsonb language sql stable set search_path='' as $$
    select jsonb_build_object('kind', row_value.kind, 'id', row_value.id, 'data', row_value.data, 'revision', row_value.revision::text, 'deleted', row_value.deleted)
$$;
create function start_private.put(u uuid, k text, ident text, value jsonb, rev bigint, tombstone boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare r start.records;
begin
    insert into start.records(user_id,account_epoch,kind,id,data,revision,deleted)
    values(u,(select epoch from start_private.accounts where user_id=u),k,ident,value,rev,tombstone)
    on conflict(user_id,kind,id) do update set data=excluded.data, revision=excluded.revision, deleted=excluded.deleted
    returning * into r;
    return start_private.entity(r);
end $$;
create function start_private.validate(k text, ident text, value jsonb)
returns void language plpgsql set search_path='' as $$
declare obs jsonb; first_at bigint; deadline bigint;
begin
    perform start_private.must(k in ('folder','subscription','preference','phrase','read','feedback','event','observation') and length(ident) between 1 and 256 and jsonb_typeof(value)='object' and octet_length(value::text)<=32768);
    case k
    when 'folder' then
        perform start_private.string(value,'name');
        perform start_private.must(jsonb_typeof(value->'position')='number' and (value->>'position')::numeric between 0 and 100000);
    when 'subscription' then
        perform start_private.string(value,'name');
        perform start_private.string(value,'folderId',256);
        perform start_private.must(start_private.string(value,'url',4096) ~ '^https?://' and jsonb_typeof(value->'isFavorite')='boolean');
    when 'preference' then
        perform start_private.must(ident in ('autoMarkReadOnScroll','autoRefreshFeeds','showRecommendedColumn') and jsonb_typeof(value->'value')='boolean');
    when 'phrase' then
        perform start_private.must(ident=start_private.hash(lower(start_private.string(value,'phrase'))) and jsonb_typeof(value->'enabled')='boolean');
    when 'read' then
        perform start_private.must(ident=start_private.item_id(start_private.string(value,'itemKey',4096)) and jsonb_typeof(value->'value')='boolean' and value->>'origin' in ('manual','auto','open','legacy'));
    when 'feedback' then
        perform start_private.must(ident=start_private.item_id(start_private.string(value,'itemKey',4096)) and jsonb_typeof(value->'clicked')='boolean' and jsonb_typeof(value->'dismissed')='boolean');
    when 'event' then
        perform start_private.string(value,'itemKey',4096);
        perform start_private.must(value->>'type' in ('impression','click','dismiss') and jsonb_typeof(value->'recordedAt')='number' and jsonb_typeof(value->'snapshot')='object');
        perform start_private.must((value->>'recordedAt')::numeric between 0 and 9007199254740991);
    when 'observation' then
        obs := value->'observation';
        perform start_private.must(jsonb_typeof(obs)='object' and obs->>'schemaVersion'='1' and obs->>'targetVersion'='click-24h-v1');
        perform start_private.string(obs,'profileId',256);
        perform start_private.string(obs,'itemKey',4096);
        perform start_private.must(ident=(obs->>'profileId') || ':' || start_private.item_id(obs->>'itemKey'));
        perform start_private.must(jsonb_typeof(obs->'firstShownAt')='number' and jsonb_typeof(obs->'deadlineAt')='number');
        first_at := (obs->>'firstShownAt')::bigint; deadline := (obs->>'deadlineAt')::bigint;
        perform start_private.must(first_at>=0 and deadline=first_at+86400000 and deadline<=9007199254740991);
        perform start_private.must((obs->>'clickAt') is null or (obs->>'clickAt')::bigint>=first_at and (obs->>'clickAt')::bigint<deadline);
        perform start_private.must((obs->>'lateClickAt') is null or (obs->>'lateClickAt')::bigint>=deadline);
        perform start_private.must((obs->>'dismissAt') is null or (obs->>'dismissAt')::bigint>=first_at);
        perform start_private.must((obs->>'completedAt') is null or (obs->>'completedAt')::bigint>=deadline);
        perform start_private.must(jsonb_typeof(obs->'snapshot')='object' and jsonb_typeof(obs->'context')='object' and jsonb_typeof(obs->'predictions')='object' and jsonb_typeof(obs->'versions')='object');
    end case;
end $$;

create function start.create_profile() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := start_private.require_user(false); a start_private.accounts;
begin
    insert into start_private.accounts(user_id) values(u) on conflict do nothing;
    select * into a from start_private.accounts where user_id=u for update;
    if not exists(select 1 from start.profiles where user_id=u) then
        insert into start.profiles(user_id) values(u);
        update start_private.accounts set epoch=epoch+1, learning_epoch=gen_random_uuid(), head=0, min_cursor=0 where user_id=u returning * into a;
    end if;
    return jsonb_build_object('epoch',a.epoch::text,'learningEpoch',a.learning_epoch::text);
end $$;
create function start.sync_register_device(p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := start_private.require_user(); a start_private.accounts; d start_private.devices;
begin
    select * into a from start_private.accounts where user_id=u for update;
    insert into start_private.devices(user_id,device_id,account_epoch) values(u,p_device,a.epoch)
    on conflict(user_id,device_id) do update set last_seen_at=now();
    select * into d from start_private.devices where user_id=u and device_id=p_device;
    perform start_private.must(d.account_epoch=a.epoch,'DEVICE_EPOCH_MISMATCH');
    return jsonb_build_object('epoch',a.epoch::text,'learningEpoch',a.learning_epoch::text,'head',a.head::text,'minCursor',a.min_cursor::text,'lastSequence',d.last_seq::text);
end $$;

create function start_private.apply(u uuid, cmd jsonb, rev bigint, device uuid)
returns jsonb language plpgsql set search_path='' as $$
declare
    typ text := cmd->>'type'; p jsonb := cmd->'payload'; ident text; k text;
    r start.records; child start.records; effects jsonb := '[]';
    v_data jsonb; item jsonb; obs jsonb; old_obs jsonb; first_at bigint; deadline bigint; at_time bigint;
    sig text; item_key text; v_profile_id text; owner uuid; n integer; position integer; before_position integer;
    ids text[]; pos integer; expected text;
begin
    perform start_private.must(jsonb_typeof(p)='object');
    if typ='entity.seed' then
        k:=p->'entity'->>'kind'; ident:=p->'entity'->>'id'; v_data:=p->'entity'->'data';
        if k='observation' then
            obs:=v_data->'observation';
            obs:=obs||jsonb_build_object('outcome',case when obs->>'completedAt' is null then null else case when obs->>'clickAt' is null then 0 else 1 end end);
            v_data:=v_data||jsonb_build_object('observation',obs);
        end if;
        perform start_private.validate(k,ident,v_data);
        select * into r from start.records as stored where user_id=u and kind=k and id=ident;
        if found then
            if k='feedback' and not r.deleted then
                v_data:=r.data || jsonb_build_object('clicked',(r.data->>'clicked')::boolean or (v_data->>'clicked')::boolean,'dismissed',(r.data->>'dismissed')::boolean or (v_data->>'dismissed')::boolean);
                if v_data<>r.data then return jsonb_build_array(start_private.put(u,k,ident,v_data,rev)); end if;
            end if;
            return effects;
        end if;
        perform start_private.must(not coalesce((p->'entity'->>'deleted')::boolean,false));
        if k='folder' then perform start_private.must((select count(*) from start.records as stored where user_id=u and kind='folder' and not deleted)<200,'FOLDER_LIMIT'); end if;
        if k='subscription' then
            perform start_private.must(exists(select 1 from start.records as stored where user_id=u and kind='folder' and id=v_data->>'folderId' and not deleted),'PARENT_DELETED');
            perform start_private.must((select count(*) from start.records as stored where user_id=u and kind='subscription' and not deleted)<2000,'SUBSCRIPTION_LIMIT');
        end if;
        if k='observation' then
            -- Imported source cohorts remain immutable archives. Only a new
            -- live profile that owns this device may issue future updates.
            v_profile_id:=v_data->'observation'->>'profileId';
            insert into start_private.learning_profiles(user_id,profile_id,device_id) values(u,v_profile_id,case when v_data->>'ownerDeviceId'=device::text then device else null end) on conflict do nothing;
        end if;
        return jsonb_build_array(start_private.put(u,k,ident,v_data,rev));
    end if;
    if typ like 'folder.%' then
        ident:=start_private.string(p,'id',256);
        select * into r from start.records as stored where user_id=u and kind='folder' and id=ident;
        if typ='folder.create' then
            perform start_private.must(r.id is null,'ID_EXISTS');
            select count(*) into n from start.records as stored where user_id=u and kind='folder' and not deleted;
            perform start_private.must(n<200,'FOLDER_LIMIT');
            return jsonb_build_array(start_private.put(u,'folder',ident,jsonb_build_object('name',start_private.string(p,'name'),'position',n),rev));
        end if;
        perform start_private.must(r.id is not null and not r.deleted,'ENTITY_DELETED');
        if typ='folder.patch' then return jsonb_build_array(start_private.put(u,'folder',ident,r.data||jsonb_build_object('name',start_private.string(p,'name')),rev)); end if;
        if typ='folder.delete' then
            effects:=jsonb_build_array(start_private.put(u,'folder',ident,'{}',rev,true));
            for child in select * from start.records as stored where user_id=u and kind='subscription' and stored.data->>'folderId'=ident and not deleted loop
                effects:=effects||jsonb_build_array(start_private.put(u,'subscription',child.id,'{}',rev,true));
            end loop;
            return effects;
        end if;
        if typ='folder.move' then
            select array_agg(id order by (stored.data->>'position')::numeric,id) into ids from start.records as stored where user_id=u and kind='folder' and not deleted and id<>ident;
            ids:=coalesce(ids,array[]::text[]); pos:=array_position(ids,p->>'beforeId');
            if pos is null then ids:=ids||ident; else ids:=coalesce(ids[1:pos-1],array[]::text[])||ident||ids[pos:]; end if;
            for position in 1..cardinality(ids) loop
                select * into child from start.records as stored where user_id=u and kind='folder' and id=ids[position];
                if (child.data->>'position')::integer<>position-1 then effects:=effects||jsonb_build_array(start_private.put(u,'folder',child.id,child.data||jsonb_build_object('position',position-1),rev)); end if;
            end loop;
            return effects;
        end if;
    elsif typ like 'subscription.%' then
        ident:=start_private.string(p,'id',256);
        select * into r from start.records as stored where user_id=u and kind='subscription' and id=ident;
        if typ='subscription.create' then
            perform start_private.must(r.id is null,'ID_EXISTS');
            perform start_private.must(exists(select 1 from start.records as stored where user_id=u and kind='folder' and id=p->>'folderId' and not deleted),'PARENT_DELETED');
            select count(*) into n from start.records as stored where user_id=u and kind='subscription' and not deleted;
            perform start_private.must(n<2000,'SUBSCRIPTION_LIMIT');
            select count(*) into position from start.records as stored where user_id=u and kind='subscription' and stored.data->>'folderId'=p->>'folderId' and not deleted;
            v_data:=jsonb_build_object('folderId',p->>'folderId','name',start_private.string(p,'name'),'url',start_private.string(p,'url',4096),'position',position,'isFavorite',coalesce((p->>'isFavorite')::boolean,false));
            perform start_private.validate('subscription',ident,v_data);
            return jsonb_build_array(start_private.put(u,'subscription',ident,v_data,rev));
        end if;
        perform start_private.must(r.id is not null and not r.deleted,'ENTITY_DELETED');
        if typ='subscription.delete' then return jsonb_build_array(start_private.put(u,'subscription',ident,'{}',rev,true)); end if;
        if typ='subscription.patch' then
            v_data:=r.data;
            perform start_private.must(jsonb_typeof(p->'changes')='object');
            if p->'changes'?'name' then v_data:=v_data||jsonb_build_object('name',start_private.string(p->'changes','name')); end if;
            if p->'changes'?'url' then v_data:=v_data||jsonb_build_object('url',start_private.string(p->'changes','url',4096)); end if;
            if p->'changes'?'isFavorite' then v_data:=v_data||jsonb_build_object('isFavorite',p->'changes'->'isFavorite'); end if;
            perform start_private.validate('subscription',ident,v_data);
            return jsonb_build_array(start_private.put(u,'subscription',ident,v_data,rev));
        end if;
    elsif typ='preference.set' then
        ident:=p->>'key'; v_data:=jsonb_build_object('value',p->'value');
        perform start_private.validate('preference',ident,v_data);
        return jsonb_build_array(start_private.put(u,'preference',ident,v_data,rev));
    elsif typ='phrase.set' then
        ident:=start_private.hash(lower(start_private.string(p,'phrase'))); v_data:=jsonb_build_object('phrase',btrim(p->>'phrase'),'enabled',p->'enabled');
        perform start_private.validate('phrase',ident,v_data);
        return jsonb_build_array(start_private.put(u,'phrase',ident,v_data,rev));
    elsif typ='read.set' then
        perform start_private.must(jsonb_typeof(p->'items')='array' and jsonb_array_length(p->'items')<=200 and jsonb_typeof(p->'value')='boolean' and p->>'origin' in ('manual','auto'));
        for item in select value from jsonb_array_elements(p->'items') loop
            item_key:=start_private.string(item,'key',4096); ident:=start_private.item_id(item_key);
            select * into r from start.records as stored where user_id=u and kind='read' and id=ident;
            if p->>'origin'<>'manual' and coalesce(r.data->>'version','0') is distinct from item->>'expected' then continue; end if;
            v_data:=jsonb_build_object('itemKey',item_key,'value',p->'value','origin',p->>'origin','version',cmd->>'op_id');
            effects:=effects||jsonb_build_array(start_private.put(u,'read',ident,v_data,rev));
        end loop;
        return effects;
    elsif typ='item.signal' then
        sig:=p->>'signal'; item_key:=start_private.string(p,'itemKey',4096); ident:=start_private.item_id(item_key);
        perform start_private.must(sig in ('impression','exposure','click','dismiss') and jsonb_typeof(p->'recordedAt')='number' and jsonb_typeof(p->'snapshot')='object');
        at_time:=(p->>'recordedAt')::bigint; perform start_private.must(at_time between 0 and 9007199168340991);
        if sig in ('click','dismiss') then
            select * into r from start.records as stored where user_id=u and kind='feedback' and id=ident;
            v_data:=jsonb_build_object('itemKey',item_key,'clicked',coalesce((r.data->>'clicked')::boolean,false) or sig='click','dismissed',coalesce((r.data->>'dismissed')::boolean,false) or sig='dismiss');
            effects:=effects||jsonb_build_array(start_private.put(u,'feedback',ident,v_data,rev));
        end if;
        if sig='click' then
            select * into r from start.records as stored where user_id=u and kind='read' and id=ident;
            if coalesce(r.data->>'version','0')=p->>'expected' then effects:=effects||jsonb_build_array(start_private.put(u,'read',ident,jsonb_build_object('itemKey',item_key,'value',true,'origin','open','version',cmd->>'op_id'),rev)); end if;
        end if;
        if sig<>'exposure' and not exists(select 1 from start.records as stored where user_id=u and kind='event' and stored.data->>'itemKey'=item_key and stored.data->>'type'=sig and not deleted) then
            v_data:=jsonb_build_object('type',sig,'itemKey',item_key,'recordedAt',at_time,'snapshot',p->'snapshot');
            perform start_private.validate('event',cmd->>'op_id',v_data);
            effects:=effects||jsonb_build_array(start_private.put(u,'event',cmd->>'op_id',v_data,rev));
        end if;
        if sig<>'impression' and p->>'profileId' is not null then
            v_profile_id:=start_private.string(p,'profileId',256);
            insert into start_private.learning_profiles(user_id,profile_id,device_id) values(u,v_profile_id,device) on conflict do nothing;
            select device_id into owner from start_private.learning_profiles where user_id=u and profile_id=v_profile_id;
            perform start_private.must(owner=device,'PROFILE_OWNER_MISMATCH');
            ident:=v_profile_id||':'||ident;
            select * into r from start.records as stored where user_id=u and kind='observation' and id=ident;
            obs:=r.data->'observation'; old_obs:=obs;
            if obs is null then
                obs:=jsonb_build_object('schemaVersion',1,'targetVersion','click-24h-v1','observationId',ident,'profileId',v_profile_id,'itemKey',item_key,'firstShownAt',at_time,'deadlineAt',at_time+86400000,'snapshot',p->'snapshot','context',coalesce(p->'context','{}'),'predictions',coalesce(p->'predictions','{}'),'versions',coalesce(p->'versions','{}'),'embeddingKey',null,'clickAt',null,'lateClickAt',null,'dismissAt',null,'completedAt',null,'outcome',null);
            end if;
            first_at:=(obs->>'firstShownAt')::bigint; deadline:=(obs->>'deadlineAt')::bigint;
            if at_time>=first_at then
                if sig='click' and at_time<deadline and obs->>'completedAt' is null and ((obs->>'clickAt') is null or (obs->>'clickAt')::bigint>at_time) then obs:=obs||jsonb_build_object('clickAt',at_time); end if;
                if sig='click' and at_time>=deadline and ((obs->>'lateClickAt') is null or (obs->>'lateClickAt')::bigint>at_time) then obs:=obs||jsonb_build_object('lateClickAt',at_time); end if;
                if sig='dismiss' and ((obs->>'dismissAt') is null or (obs->>'dismissAt')::bigint>at_time) then obs:=obs||jsonb_build_object('dismissAt',at_time); end if;
            end if;
            v_data:=jsonb_build_object('observation',obs,'ownerDeviceId',device::text,'generation',p->>'generation');
            perform start_private.validate('observation',ident,v_data);
            if obs is distinct from old_obs then effects:=effects||jsonb_build_array(start_private.put(u,'observation',ident,v_data,rev)); end if;
        end if;
        return effects;
    elsif typ='prediction.update' then
        obs:=p->'observation'; v_profile_id:=start_private.string(obs,'profileId',256); ident:=v_profile_id||':'||start_private.item_id(obs->>'itemKey');
        select device_id into owner from start_private.learning_profiles where user_id=u and profile_id=v_profile_id;
        perform start_private.must(owner=device,'PROFILE_OWNER_MISMATCH');
        select * into r from start.records as stored where user_id=u and kind='observation' and id=ident;
        perform start_private.must(r.id is not null,'OBSERVATION_MISSING');
        old_obs:=r.data->'observation';
        perform start_private.must((obs-array['clickAt','lateClickAt','dismissAt','completedAt','outcome'])=(old_obs-array['clickAt','lateClickAt','dismissAt','completedAt','outcome']),'IMMUTABLE_OBSERVATION');
        perform start_private.must(old_obs->>'completedAt' is null or (old_obs->'clickAt'=obs->'clickAt' and old_obs->'outcome'=obs->'outcome'),'CLOSED_OBSERVATION');
        for k in select unnest(array['clickAt','lateClickAt','dismissAt','completedAt']) loop
            perform start_private.must(old_obs->>k is null or (obs->>k is not null and (obs->>k)::bigint=(old_obs->>k)::bigint),'NON_MONOTONIC_OBSERVATION');
        end loop;
        obs:=obs||jsonb_build_object('outcome',case when obs->>'completedAt' is null then null else case when obs->>'clickAt' is null then 0 else 1 end end);
        v_data:=r.data||jsonb_build_object('observation',obs);
        perform start_private.validate('observation',ident,v_data);
        return jsonb_build_array(start_private.put(u,'observation',ident,v_data,rev));
    end if;
    raise exception 'UNKNOWN_COMMAND';
end $$;

create function start.sync_push(p_epoch text, p_device uuid, p_base_revision text, p_commands jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user(); a start_private.accounts; d start_private.devices; cmd jsonb; seq bigint; fingerprint text; receipt start_private.receipts; result jsonb; results jsonb:='[]'; effects jsonb; failure text;
begin
    perform start_private.must(jsonb_typeof(p_commands)='array' and jsonb_array_length(p_commands)<=100 and octet_length(p_commands::text)<=262144,'BATCH_LIMIT');
    select * into a from start_private.accounts where user_id=u for update;
    perform start_private.must(a.epoch::text=p_epoch,'EPOCH_MISMATCH');
    perform start_private.must(p_base_revision::bigint>=a.min_cursor,'SNAPSHOT_REQUIRED');
    select * into d from start_private.devices where user_id=u and device_id=p_device;
    perform start_private.must(d.device_id is not null and d.account_epoch=a.epoch,'DEVICE_UNKNOWN');
    for cmd in select value from jsonb_array_elements(p_commands) loop
        seq:=(cmd->>'client_seq')::bigint;
        perform start_private.must(cmd->>'protocol_version'='1' and cmd->>'account_epoch'=p_epoch and seq>0,'INVALID_COMMAND');
        fingerprint:=start_private.hash(cmd::text);
        if seq<=d.last_seq then
            select * into receipt from start_private.receipts where user_id=u and account_epoch=a.epoch and device_id=p_device and sequence=seq;
            if receipt.op_id is null then result:=jsonb_build_object('op_id',cmd->>'op_id','status','expired','code','RECEIPT_EXPIRED');
            else perform start_private.must(receipt.op_id::text=cmd->>'op_id' and receipt.request_hash=fingerprint,'REPLAY_MISMATCH'); result:=receipt.result; end if;
            results:=results||jsonb_build_array(result); continue;
        end if;
        perform start_private.must(seq=d.last_seq+1,'SEQUENCE_GAP');
        begin
            if (cmd->>'type' in ('item.signal','prediction.update') or (cmd->>'type'='entity.seed' and cmd->'payload'->'entity'->>'kind' in ('feedback','event','observation'))) then perform start_private.must(cmd->>'learning_epoch'=a.learning_epoch::text,'LEARNING_EPOCH_MISMATCH'); end if;
            effects:=start_private.apply(u,cmd,a.head+1,p_device);
            if jsonb_array_length(effects)>0 then
                a.head:=a.head+1;
                insert into start_private.changes(user_id,account_epoch,revision,effects) values(u,a.epoch,a.head,effects);
                result:=jsonb_build_object('op_id',cmd->>'op_id','status','accepted','revision',a.head::text);
            else result:=jsonb_build_object('op_id',cmd->>'op_id','status','noop','revision',a.head::text); end if;
        exception when raise_exception then
            get stacked diagnostics failure=message_text;
            result:=jsonb_build_object('op_id',cmd->>'op_id','status','rejected','code',failure);
        when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or check_violation or not_null_violation then
            result:=jsonb_build_object('op_id',cmd->>'op_id','status','rejected','code','INVALID_COMMAND');
        end;
        insert into start_private.receipts(user_id,account_epoch,device_id,sequence,op_id,request_hash,result) values(u,a.epoch,p_device,seq,(cmd->>'op_id')::uuid,fingerprint,result);
        d.last_seq:=seq; results:=results||jsonb_build_array(result);
    end loop;
    update start_private.accounts set head=a.head where user_id=u;
    update start_private.devices set last_seq=d.last_seq,last_seen_at=now() where user_id=u and device_id=p_device;
    return jsonb_build_object('receipts',results,'head',a.head::text);
end $$;
create function start.sync_pull(p_epoch text, p_after text, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user(); answer jsonb;
begin
    perform start_private.must(p_limit between 1 and 500);
    -- Bounds and entries use one SQL statement snapshot. Revisions are ordered
    -- by the account lock, not an independently committed sequence.
    with bounds as (select * from start_private.accounts where user_id=u), page as (
        select c.* from start_private.changes c, bounds b where c.user_id=u and c.account_epoch=b.epoch and c.revision>p_after::bigint and c.revision<=b.head order by c.revision limit p_limit
    ) select jsonb_build_object('epoch',b.epoch::text,'learningEpoch',b.learning_epoch::text,'head',b.head::text,'minCursor',b.min_cursor::text,'cursor',coalesce((select max(revision) from page),p_after::bigint)::text,'changes',coalesce((select jsonb_agg(effects order by revision) from page),'[]')) into answer from bounds b;
    perform start_private.must(answer->>'epoch'=p_epoch,'EPOCH_MISMATCH');
    perform start_private.must(p_after::bigint>=(answer->>'minCursor')::bigint,'SNAPSHOT_REQUIRED');
    return answer;
end $$;
create function start.sync_snapshot_begin() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user(); a start_private.accounts; ident uuid;
begin
    select * into a from start_private.accounts where user_id=u for update;
    delete from start_private.snapshots where expires_at<now();
    -- Concurrent devices may page their own fixed snapshots independently.
    insert into start_private.snapshots(user_id,account_epoch,learning_epoch,revision) values(u,a.epoch,a.learning_epoch,a.head) returning id into ident;
    insert into start_private.snapshot_rows(snapshot_id,position,entity)
    select ident,row_number() over(order by kind,id),start_private.entity(r) from start.records r where user_id=u;
    return jsonb_build_object('id',ident::text,'epoch',a.epoch::text,'learningEpoch',a.learning_epoch::text,'cursor',a.head::text);
end $$;
create function start.sync_snapshot_page(p_id uuid,p_after integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user(); snapshot start_private.snapshots; answer jsonb;
begin
    select * into snapshot from start_private.snapshots where id=p_id and user_id=u and expires_at>now();
    perform start_private.must(snapshot.id is not null,'SNAPSHOT_EXPIRED');
    with page as (select * from start_private.snapshot_rows where snapshot_id=p_id and position>p_after order by position limit 200)
    select jsonb_build_object('records',coalesce(jsonb_agg(entity order by position),'[]'),'next',coalesce(max(position),p_after),'done',not exists(select 1 from start_private.snapshot_rows where snapshot_id=p_id and position>coalesce((select max(position) from page),p_after))) into answer from page;
    return answer;
end $$;
create function start.reset_learning(p_expected text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user(); a start_private.accounts; effects jsonb;
begin
    select * into a from start_private.accounts where user_id=u for update;
    perform start_private.must(a.learning_epoch::text=p_expected,'LEARNING_EPOCH_MISMATCH');
    update start.records set deleted=true,data='{}',revision=a.head+1 where user_id=u and kind in ('feedback','event','observation') and not deleted;
    select coalesce(jsonb_agg(start_private.entity(r)),'[]') into effects from start.records r where user_id=u and revision=a.head+1;
    delete from start_private.learning_profiles where user_id=u;
    update start_private.accounts set learning_epoch=gen_random_uuid(),head=head+1 where user_id=u returning * into a;
    insert into start_private.changes(user_id,account_epoch,revision,effects) values(u,a.epoch,a.head,effects);
    return jsonb_build_object('epoch',a.epoch::text,'learningEpoch',a.learning_epoch::text);
end $$;
create function start.reset_account(p_expected text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user(); a start_private.accounts;
begin
    select * into a from start_private.accounts where user_id=u for update;
    perform start_private.must(a.epoch::text=p_expected,'EPOCH_MISMATCH');
    delete from start.records where user_id=u;
    delete from start_private.changes where user_id=u;
    delete from start_private.receipts where user_id=u;
    delete from start_private.devices where user_id=u;
    delete from start_private.learning_profiles where user_id=u;
    delete from start_private.snapshots where user_id=u;
    update start_private.accounts set epoch=epoch+1,learning_epoch=gen_random_uuid(),head=0,min_cursor=0 where user_id=u returning * into a;
    return jsonb_build_object('epoch',a.epoch::text,'learningEpoch',a.learning_epoch::text);
end $$;
create function start.delete_profile(p_expected text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=start_private.require_user();
begin
    perform start.reset_account(p_expected);
    delete from start.profiles where user_id=u;
end $$;

revoke all on all tables in schema start_private from public,anon,authenticated;
revoke execute on all functions in schema start_private from public,anon,authenticated;
revoke execute on all functions in schema start from public,anon,authenticated;
grant execute on function start.create_profile(),start.sync_register_device(uuid),start.sync_push(text,uuid,text,jsonb),start.sync_pull(text,text,integer),start.sync_snapshot_begin(),start.sync_snapshot_page(uuid,integer),start.reset_learning(text),start.reset_account(text),start.delete_profile(text) to authenticated;
commit;
