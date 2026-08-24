# Campamento Manantial — Sitio de inscripción

Todos los datos (nombre del campamento, fechas, precio, iglesia, itinerario) son
**de ejemplo**. Edítalos directamente en `frontend/index.html`.

## Estructura

```
campamento/
├── frontend/          → página estática (HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── script.js
└── backend/            → API que guarda las inscripciones en Supabase
    ├── server.js
    ├── package.json
    ├── .env.example
    └── schema.sql
```

## 1. Configurar Supabase

1. Crea un proyecto en https://supabase.com
2. Ve a **SQL Editor** y ejecuta el contenido de `backend/schema.sql`
3. Ve a **Project Settings → API** y copia:
   - `Project URL` → `SUPABASE_URL`
   - `service_role key` (secreta, NO la `anon` key) → `SUPABASE_SERVICE_KEY`

## 2. Configurar y correr el backend

```bash
cd backend
cp .env.example .env
# edita .env y pega tus credenciales de Supabase
npm install
npm start
```

El servidor queda corriendo en `http://localhost:3000`.

## 3. Abrir el frontend

Abre `frontend/index.html` directamente en el navegador (o sírvelo con
`npx serve frontend`). El formulario envía los datos a
`http://localhost:3000/api/inscripciones`.

Si despliegas el backend en otro lugar (Render, Railway, etc.), actualiza la
constante `API_URL` en `frontend/script.js` con la URL real.

## 4. Ver las inscripciones

`GET http://localhost:3000/api/inscripciones` devuelve la lista completa y el
número de cupos disponibles — útil para un panel administrativo simple, o
puedes revisarlas directamente en la tabla `inscripciones` de Supabase.

## Qué editar primero

- **Nombre del campamento, iglesia, fechas, lugar, costo**: en el `<section class="hero">`
  y `<section id="detalles">` de `frontend/index.html`.
- **Itinerario**: `<section id="itinerario">`.
- **Cupo total**: variable `CUPO_TOTAL` en `.env` (backend) — debe coincidir con
  lo que muestres en el frontend.
- **Campos del formulario**: agrega o quita `<div class="form-row">` en la
  sección `#inscripcion`, y ajusta `server.js` (validación + insert) y
  `schema.sql` (columnas) para que coincidan.
