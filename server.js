require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const CUPO_TOTAL = parseInt(process.env.CUPO_TOTAL || "120", 10);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Crea una nueva inscripción
app.post("/api/inscripciones", async (req, res) => {
  const {
    nombre,
    edad,
    telefono,
    iglesia,
    contacto_nombre,
    contacto_telefono,
    talla,
    alergias,
    notas,
  } = req.body;

  // Validación básica de campos obligatorios
  const requeridos = { nombre, edad, telefono, iglesia, contacto_nombre, contacto_telefono, talla };
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
        talla,
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

  return res.json({ total: data.length, cuposDisponibles: Math.max(CUPO_TOTAL - data.length, 0), inscripciones: data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de inscripciones corriendo en http://localhost:${PORT}`);
});
