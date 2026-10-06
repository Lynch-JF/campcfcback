-- Se ejecuta solo al arrancar el servidor (server.js). Es seguro correrlo varias veces.

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

-- ===========================================================
-- EVALUACIONES DE PERSONAL (Ficha de Valoración — Grupo Michel)
-- ===========================================================
create table if not exists evaluaciones (
  id text primary key,
  puesto text not null,
  nombre text not null,
  tienda text not null,
  cargo text,
  periodo text not null,
  evaluador text,
  fecha date,
  fortalezas text,
  mejoras text,
  comentarios_evaluado text,
  respuestas jsonb not null default '{}'::jsonb,
  puntaje_ponderado double precision,
  puntaje_entero integer check (puntaje_entero between 1 and 5),
  categoria text,
  firma_evaluador text,
  firma_colaborador text,
  enviada_el timestamp with time zone default now(),
  -- una sola evaluación por empleado, tienda y período
  constraint uq_eval_periodo unique (tienda, nombre, periodo)
);

-- Para bases ya creadas: agrega la columna de comentarios del colaborador evaluado
alter table evaluaciones add column if not exists comentarios_evaluado text;

create index if not exists idx_eval_tienda_periodo on evaluaciones (tienda, periodo);
