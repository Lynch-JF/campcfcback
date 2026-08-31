require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
// Las firmas van en base64 dentro del JSON, así que subimos el límite por defecto (1mb)
app.use(express.json({ limit: "5mb" }));

const CUPO_TOTAL = parseInt(process.env.CUPO_TOTAL || "120", 10);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===========================================================
   INSCRIPCIONES (sin cambios)
   =========================================================== */

// Crea una nueva inscripción
app.post("/api/inscripciones", async (req, res) => {
  const {
    nombre,
    edad,
    telefono,
    iglesia,
    contacto_nombre,
    contacto_telefono,
    alergias,
    notas,
  } = req.body;

  // Validación básica de campos obligatorios
  const requeridos = { nombre, edad, telefono, iglesia, contacto_nombre, contacto_telefono };
  for (const [campo, valor] of Object.entries(requeridos)) {
    if (!valor) {
      return res.status(400).json({ error: `Falta el campo requerido: ${campo}` });
    }
  }

  try {
    const { error: insertError } = await supabase.from("inscripciones").insert([
      {
        nombre,
        edad: parseInt(edad, 10),
        telefono,
        iglesia,
        contacto_nombre,
        contacto_telefono,
        alergias: alergias || null,
        notas: notas || null,
      },
    ]);

    if (insertError) {
      console.error("Error de Supabase:", insertError);
      return res.status(500).json({ error: "No se pudo guardar la inscripción." });
    }

    const { count, error: countError } = await supabase
      .from("inscripciones")
      .select("*", { count: "exact", head: true });

    const cuposDisponibles = countError ? null : Math.max(CUPO_TOTAL - (count || 0), 0);

    return res.status(201).json({ ok: true, cuposDisponibles });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error inesperado en el servidor." });
  }
});

// Lista todas las inscripciones (para uso administrativo)
app.get("/api/inscripciones", async (req, res) => {
  const { data, error } = await supabase
    .from("inscripciones")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "No se pudo obtener la lista." });
  }

  return res.json({
    total: data.length,
    cuposDisponibles: Math.max(CUPO_TOTAL - data.length, 0),
    inscripciones: data,
  });
});

/* ===========================================================
   EVALUACIONES DE PERSONAL
   =========================================================== */

// Categorías válidas — deben coincidir con el CHECK constraint de la tabla
const CATEGORIAS_VALIDAS = ["Muy deficiente", "Deficiente", "Regular", "Bueno", "Excelente"];

// Crea una nueva evaluación finalizada
app.post("/api/evaluaciones", async (req, res) => {
  const {
    id,
    puesto,
    nombre,
    tienda,
    cargo,
    periodo,
    evaluador,
    fecha,
    fortalezas,
    mejoras,
    respuestas,
    puntajePonderado,
    puntajeEntero,
    categoria,
    firmaEvaluador,
    firmaColaborador,
  } = req.body;

  // Validación básica de campos obligatorios
  if (!puesto || !nombre) {
    return res.status(400).json({ error: "Falta el campo requerido: puesto o nombre" });
  }

  // Validación de integridad: si viene puntajeEntero o categoría, deben ser válidos
  // (además de las validaciones de la BD, esto da un mensaje claro antes de golpear Postgres)
  if (
    puntajeEntero !== undefined &&
    puntajeEntero !== null &&
    (puntajeEntero < 1 || puntajeEntero > 5)
  ) {
    return res.status(400).json({ error: "puntajeEntero debe estar entre 1 y 5" });
  }
  if (categoria && !CATEGORIAS_VALIDAS.includes(categoria)) {
    return res.status(400).json({ error: "categoria no reconocida" });
  }

  try {
    const { error: insertError } = await supabase.from("evaluaciones").insert([
      {
        id,
        puesto,
        nombre,
        tienda: tienda || null,
        cargo: cargo || null,
        periodo: periodo || null,
        evaluador: evaluador || null,
        fecha: fecha || null,
        fortalezas: fortalezas || null,
        mejoras: mejoras || null,
        respuestas: respuestas || {},
        puntaje_ponderado: puntajePonderado,
        puntaje_entero: puntajeEntero,
        categoria: categoria || null,
        firma_evaluador: firmaEvaluador || null,
        firma_colaborador: firmaColaborador || null,
        // enviada_el NO se manda: la BD la pone sola con default now(),
        // así no dependemos del reloj del celular/navegador del evaluador.
      },
    ]);

    if (insertError) {
      // 23505 = violación de UNIQUE (ya existe una evaluación para ese
      // empleado + tienda + período — ver constraint uq_eval_periodo)
      if (insertError.code === "23505") {
        return res.status(409).json({
          error: "Ya existe una evaluación registrada para este empleado en este período.",
        });
      }
      console.error("Error de Supabase:", insertError);
      return res.status(500).json({ error: "No se pudo guardar la evaluación." });
    }

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error inesperado en el servidor." });
  }
});

// Lista todas las evaluaciones (panel de Gestión Humana)
// Soporta filtros opcionales por querystring: ?tienda=...&puesto=...
app.get("/api/evaluaciones", async (req, res) => {
  const { tienda, puesto } = req.query;

  let query = supabase.from("evaluaciones").select("*").order("enviada_el", { ascending: false });

  if (tienda) query = query.eq("tienda", tienda);
  if (puesto) query = query.eq("puesto", puesto);

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "No se pudo obtener la lista." });
  }

  return res.json({ total: data.length, evaluaciones: data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
