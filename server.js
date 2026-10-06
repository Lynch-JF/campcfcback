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
