-- ============================================================
--  GenClash · Equipos personalizados (modo "Mi equipo")
--  Cada usuario guarda un equipo de hasta 6 Pokémon con 4 movimientos.
--  Solo se lee y escribe con funciones que exigen una sesión válida.
-- ============================================================
create table if not exists public.equipos (
  usuario_id   uuid primary key references public.usuarios (id) on delete cascade,
  equipo       jsonb not null default '[]'::jsonb,
  actualizado  timestamptz not null default now(),
  constraint equipo_es_lista check (jsonb_typeof(equipo) = 'array' and jsonb_array_length(equipo) <= 6)
);
alter table public.equipos enable row level security;
revoke all on public.equipos from anon, authenticated;

create or replace function public.guardar_equipo(p_token uuid, p_equipo jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select s.usuario_id into v_id from sesiones s where s.token = p_token and s.expira > now();
  if not found then raise exception 'SESION_INVALIDA'; end if;
  if jsonb_typeof(p_equipo) <> 'array' or jsonb_array_length(p_equipo) > 6 or octet_length(p_equipo::text) > 8000 then
    raise exception 'EQUIPO_INVALIDO';
  end if;
  insert into equipos (usuario_id, equipo, actualizado) values (v_id, p_equipo, now())
  on conflict (usuario_id) do update set equipo = excluded.equipo, actualizado = now();
end $$;

create or replace function public.obtener_equipo(p_token uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce((select e.equipo from equipos e join sesiones s on s.usuario_id = e.usuario_id
                   where s.token = p_token and s.expira > now()), '[]'::jsonb);
$$;

grant execute on function public.guardar_equipo(uuid, jsonb), public.obtener_equipo(uuid) to anon, authenticated;
