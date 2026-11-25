require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
// Las firmas van en base64 dentro del JSON, así que subimos el límite por defecto (1mb)
app.use(express.json({ limit: "5mb" }));

const CUPO_TOTAL = parseInt(process.env.CUPO_TOTAL || "120", 10);
const ADMIN_KEY = process.env.ADMIN_KEY || "";

if (!process.env.DATABASE_URL) {
  console.error("Falta la variable DATABASE_URL.");
  process.exit(1);
}

// Dentro de Railway (host *.railway.internal) no se usa SSL; por la URL pública sí.
const usaSSL = !/railway\.internal|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usaSSL ? { rejectUnauthorized: false } : false,
});

// Si defines ADMIN_KEY, los listados piden el header "x-admin-key".
// Si no la defines, quedan abiertos como antes.
function soloAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();
  if (req.get("x-admin-key") === ADMIN_KEY) return next();
  return res.status(401).json({ error: "No autorizado." });
}

app.get("/", (req, res) => res.json({ ok: true }));

/* ===========================================================
   INSCRIPCIONES
   =========================================================== */

app.post("/api/inscripciones", async (req, res) => {
  const {
    nombre, edad, telefono, iglesia,
    contacto_nombre, contacto_telefono, talla, alergias, notas,
  } = req.body || {};

  const requeridos = { nombre, edad, telefono, iglesia, contacto_nombre, contacto_telefono };
  for (const [campo, valor] of Object.entries(requeridos)) {
    if (!valor) {
      return res.status(400).json({ error: `Falta el campo requerido: ${campo}` });
    }
  }
  const edadNum = parseInt(edad, 10);
  if (Number.isNaN(edadNum)) {
    return res.status(400).json({ error: "edad debe ser un número" });
  }

  try {
    await pool.query(
      `insert into inscripciones
         (nombre, edad, telefono, iglesia, contacto_nombre, contacto_telefono, talla, alergias, notas)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [nombre, edadNum, telefono, iglesia, contacto_nombre, contacto_telefono,
       talla || null, alergias || null, notas || null]
    );
    const { rows } = await pool.query("select count(*)::int as total from inscripciones");
    return res.status(201).json({
      ok: true,
      cuposDisponibles: Math.max(CUPO_TOTAL - rows[0].total, 0),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo guardar la inscripción." });
  }
});

app.get("/api/inscripciones", soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("select * from inscripciones order by created_at desc");
    return res.json({
      total: rows.length,
      cuposDisponibles: Math.max(CUPO_TOTAL - rows.length, 0),
      inscripciones: rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo obtener la lista." });
  }
});

/* ===========================================================
   EVALUACIONES DE PERSONAL
   =========================================================== */

const CATEGORIAS_VALIDAS = ["Muy deficiente", "Deficiente", "Regular", "Bueno", "Excelente"];

app.post("/api/evaluaciones", async (req, res) => {
  const {
    id, puesto, nombre, tienda, cargo, periodo, evaluador, fecha,
    fortalezas, mejoras, comentariosEvaluado, respuestas,
    puntajePonderado, puntajeEntero, categoria,
    firmaEvaluador, firmaColaborador,
  } = req.body || {};

  const requeridos = { id, puesto, nombre, tienda, periodo };
  for (const [campo, valor] of Object.entries(requeridos)) {
    if (!valor) {
      return res.status(400).json({ error: `Falta el campo requerido: ${campo}` });
    }
  }
  if (puntajeEntero != null && (puntajeEntero < 1 || puntajeEntero > 5)) {
    return res.status(400).json({ error: "puntajeEntero debe estar entre 1 y 5" });
  }
  if (categoria && !CATEGORIAS_VALIDAS.includes(categoria)) {
    return res.status(400).json({ error: "categoria no reconocida" });
  }

  try {
    await pool.query(
      `insert into evaluaciones
         (id, puesto, nombre, tienda, cargo, periodo, evaluador, fecha,
          fortalezas, mejoras, respuestas,
          puntaje_ponderado, puntaje_entero, categoria,
          firma_evaluador, firma_colaborador, comentarios_evaluado)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)`,
      [
        String(id), puesto, nombre, tienda, cargo || null, periodo,
        evaluador || null, fecha || null,
        fortalezas || null, mejoras || null,
        JSON.stringify(respuestas || {}),
        puntajePonderado ?? null, puntajeEntero ?? null, categoria || null,
        firmaEvaluador || null, firmaColaborador || null,
        comentariosEvaluado || null,
        // enviada_el la pone la BD con default now()
      ]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    // 23505 = violación de UNIQUE (uq_eval_periodo o id repetido)
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Ya existe una evaluación registrada para este empleado en este período.",
      });
    }
    console.error(err);
    return res.status(500).json({ error: "No se pudo guardar la evaluación." });
  }
});

// Firmas ya usadas en una tienda y período = empleados que ya tienen evaluación.
// Devuelve solo nombres (sin puntajes ni firmas), por eso es público.
app.get("/api/firmas-usadas", async (req, res) => {
  const { tienda, periodo } = req.query;
  if (!tienda) return res.status(400).json({ error: "Falta el parámetro tienda" });
  try {
    const { rows } = await pool.query(
      `select nombre from evaluaciones
        where tienda = $1 and ($2::text is null or periodo = $2)
        order by nombre`,
      [tienda, periodo || null]
    );
    return res.json({ usadas: rows.map((r) => r.nombre) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo obtener la lista." });
  }
});

// Panel de Gestión Humana. Filtros opcionales: ?tienda=&puesto=&periodo=
app.get("/api/evaluaciones", soloAdmin, async (req, res) => {
  const { tienda, puesto, periodo } = req.query;
  const filtros = [];
  const valores = [];
  for (const [col, val] of [["tienda", tienda], ["puesto", puesto], ["periodo", periodo]]) {
    if (val) {
      valores.push(val);
      filtros.push(`${col} = $${valores.length}`);
    }
  }
  const where = filtros.length ? `where ${filtros.join(" and ")}` : "";
  try {
    const { rows } = await pool.query(
      `select * from evaluaciones ${where} order by enviada_el desc`,
      valores
    );
    return res.json({ total: rows.length, evaluaciones: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo obtener la lista." });
  }
});

/* ===========================================================
   PERSONAL POR TIENDA Y FIRMAS (Panel de Gestión Humana)
   =========================================================== */

// Para editar, ADMIN_KEY es obligatoria: sin ella las rutas de escritura no quedan abiertas.
function soloAdminEscritura(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ error: "Define ADMIN_KEY en el servidor para poder editar el personal." });
  }
  if (req.get("x-admin-key") === ADMIN_KEY) return next();
  return res.status(401).json({ error: "No autorizado." });
}

// Los nombres se guardan como en la ficha: en mayúsculas y sin espacios de más.
const limpiarNombre = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const FIRMA_VALIDA = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
const FIRMA_MAX = 1500000;

// Lista de tiendas, evaluadores y empleados. Pública: la ficha la necesita sin contraseña.
// evaluadorAdmin es quien evalúa a los administradores (null = el que trae la ficha).
app.get("/api/personal", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select tienda, evaluador, auxiliares from personal_tiendas order by orden, tienda"
    );
    const ajuste = await pool.query("select valor from ajustes_personal where clave = 'evaluador_admin'");
    return res.json({
      configurado: rows.length > 0,
      tiendas: rows,
      evaluadorAdmin: ajuste.rows[0] ? ajuste.rows[0].valor : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo obtener el personal." });
  }
});

// Reemplaza la lista completa. Body: { tiendas: [{ tienda, evaluador, auxiliares: [] }], evaluadorAdmin? }
app.put("/api/personal", soloAdminEscritura, async (req, res) => {
  const lista = req.body && req.body.tiendas;
  if (!Array.isArray(lista) || !lista.length) {
    return res.status(400).json({ error: "Envía al menos una tienda." });
  }
  const vistas = new Set();
  const limpias = [];
  for (const t of lista) {
    const tienda = limpiarNombre(t && t.tienda);
    if (!tienda) return res.status(400).json({ error: "Hay una tienda sin nombre." });
    if (vistas.has(tienda)) return res.status(400).json({ error: `La tienda ${tienda} está repetida.` });
    vistas.add(tienda);
    const auxiliares = [...new Set(
      (Array.isArray(t.auxiliares) ? t.auxiliares : []).map(limpiarNombre).filter(Boolean)
    )];
    limpias.push({ tienda, evaluador: limpiarNombre(t.evaluador) || null, auxiliares });
  }
  const cambiaAdmin = req.body.evaluadorAdmin !== undefined;
  const evaluadorAdmin = limpiarNombre(req.body.evaluadorAdmin) || null;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from personal_tiendas");
    for (const [i, t] of limpias.entries()) {
      await client.query(
        `insert into personal_tiendas (tienda, evaluador, auxiliares, orden)
         values ($1, $2, $3::jsonb, $4)`,
        [t.tienda, t.evaluador, JSON.stringify(t.auxiliares), i]
      );
    }
    if (cambiaAdmin) {
      await client.query(
        `insert into ajustes_personal (clave, valor) values ('evaluador_admin', $1)
         on conflict (clave) do update set valor = excluded.valor, actualizado_el = now()`,
        [evaluadorAdmin]
      );
    }
    await client.query("commit");
    const ajuste = await pool.query("select valor from ajustes_personal where clave = 'evaluador_admin'");
    return res.json({ ok: true, tiendas: limpias, evaluadorAdmin: ajuste.rows[0] ? ajuste.rows[0].valor : null });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(err);
    return res.status(500).json({ error: "No se pudo guardar el personal." });
  } finally {
    client.release();
  }
});

// Firmas de las personas pedidas: ?nombre=A&nombre=B. Pública, igual que la carpeta firmas/ del sitio.
app.get("/api/firmas", async (req, res) => {
  let nombres = req.query.nombre || [];
  if (typeof nombres === "string") nombres = [nombres];
  else if (!Array.isArray(nombres)) nombres = Object.values(nombres);
  nombres = [...new Set(nombres.map(limpiarNombre).filter(Boolean))].slice(0, 80);
  if (!nombres.length) return res.json({ firmas: {} });
  try {
    const { rows } = await pool.query(
      "select nombre, imagen from firmas_personal where nombre = any($1)",
      [nombres]
    );
    return res.json({ firmas: Object.fromEntries(rows.map((r) => [r.nombre, r.imagen])) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudieron obtener las firmas." });
  }
});

// Guarda o reemplaza la firma de una persona. Body: { nombre, imagen: "data:image/png;base64,..." }
app.put("/api/firmas", soloAdminEscritura, async (req, res) => {
  const nombre = limpiarNombre(req.body && req.body.nombre);
  const imagen = req.body && req.body.imagen;
  if (!nombre) return res.status(400).json({ error: "Falta el nombre." });
  if (typeof imagen !== "string" || !FIRMA_VALIDA.test(imagen)) {
    return res.status(400).json({ error: "La firma debe ser una imagen PNG, JPG o WEBP." });
  }
  if (imagen.length > FIRMA_MAX) {
    return res.status(413).json({ error: "La imagen de la firma es demasiado grande." });
  }
  try {
    await pool.query(
      `insert into firmas_personal (nombre, imagen) values ($1, $2)
       on conflict (nombre) do update set imagen = excluded.imagen, actualizado_el = now()`,
      [nombre, imagen]
    );
    return res.json({ ok: true, nombre });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo guardar la firma." });
  }
});

// Borra la firma guardada de una persona: ?nombre=
app.delete("/api/firmas", soloAdminEscritura, async (req, res) => {
  const nombre = limpiarNombre(req.query.nombre);
  if (!nombre) return res.status(400).json({ error: "Falta el nombre." });
  try {
    await pool.query("delete from firmas_personal where nombre = $1", [nombre]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo borrar la firma." });
  }
});

/* ===========================================================
   ARRANQUE: crea las tablas si no existen y levanta el servidor
   =========================================================== */
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(schema);
    console.log("Esquema verificado.");
  } catch (err) {
    console.error("No se pudo preparar la base de datos:", err);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
})();
