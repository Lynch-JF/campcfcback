-- Ejecuta esto en el SQL Editor de tu proyecto de Supabase

create table if not exists inscripciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  edad integer not null,
  telefono text not null,
  iglesia text not null,
  contacto_nombre text not null,
  contacto_telefono text not null,
  talla text not null,
  alergias text,
  notas text,
  created_at timestamp with time zone default now()
);

-- (Opcional) Habilitar Row Level Security.
-- El backend usa la service_role key, que ignora RLS, así que esto
-- solo protege la tabla contra accesos directos desde el frontend.
alter table inscripciones enable row level security;
