const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const {
  registrarUsuario,
  loginUsuario,
  obtenerPerfil,
  actualizarFinCursada,
  migrarInvitado,
  solicitarRecuperacion,
  resetearPassword
} = require('./controllers/authController');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------
app.post('/api/auth/register', registrarUsuario);
app.post('/api/auth/login', loginUsuario);
app.get('/api/auth/me', obtenerPerfil);
app.put('/api/auth/fin-cursada', actualizarFinCursada);
app.post('/api/auth/migrar-invitado', migrarInvitado);
app.post('/api/auth/recuperar', solicitarRecuperacion);
app.post('/api/auth/reset-password', resetearPassword);

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------

// TODO: hoy el login devuelve un token fijo, así que no se sabe quién es
// el usuario. Cuando agregues JWT, reemplazá esto por req.usuarioId real.
const usuarioId = (req) => req.usuarioId || 1;

const PROTEGIDAS = ['id', 'usuario_id', 'created_at'];
const cacheColumnas = {};

// Lee las columnas reales de la tabla desde Supabase (y las guarda en memoria)
async function columnasDe(tabla) {
  if (!cacheColumnas[tabla]) {
    const r = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tabla]
    );
    cacheColumnas[tabla] = r.rows.map((x) => x.column_name);
  }
  return cacheColumnas[tabla];
}

// Se queda solo con los campos que existen en la tabla; '' pasa a null
async function datosPermitidos(tabla, body) {
  const cols = await columnasDe(tabla);
  const data = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (cols.includes(k) && !PROTEGIDAS.includes(k)) {
      data[k] = v === '' ? null : v;
    }
  }
  return { cols, data };
}

function responderError(res, err) {
  console.error('Error en API:', err);
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe ese registro' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referencia inválida (materia o usuario inexistente)' });
  if (err.code === '23502') return res.status(400).json({ error: `Falta un campo obligatorio: ${err.column || ''}` });
  res.status(500).json({ error: err.message, detail: err.detail });
}

function insertar(tabla, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${tabla} (${keys.map((k) => `"${k}"`).join(', ')})
               VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
  return db.query(sql, keys.map((k) => data[k]));
}

// Crea GET / POST / PUT /:id / DELETE /:id para una tabla con usuario_id
function crud(ruta, tabla, normalizar = (b) => b, conJoin = true) {
  const base = `/api/${ruta}`;

  app.get(base, async (req, res) => {
    try {
      // El frontend espera materia_nombre en horarios, exámenes y TPs
      const sql = conJoin
        ? `SELECT t.*, m.nombre AS materia_nombre FROM ${tabla} t
           JOIN materias m ON m.id = t.materia_id
           WHERE t.usuario_id = $1 ORDER BY t.id`
        : `SELECT * FROM ${tabla} WHERE usuario_id = $1 ORDER BY id`;
      const r = await db.query(sql, [usuarioId(req)]);
      res.json(r.rows);
    } catch (err) { responderError(res, err); }
  });

  app.post(base, async (req, res) => {
    try {
      const { data } = await datosPermitidos(tabla, normalizar(req.body, true));
      data.usuario_id = usuarioId(req);
      const r = await insertar(tabla, data);
      res.status(201).json(r.rows[0]);
    } catch (err) { responderError(res, err); }
  });

  app.put(`${base}/:id`, async (req, res) => {
    try {
      const { data } = await datosPermitidos(tabla, normalizar(req.body, false));
      const keys = Object.keys(data);
      if (!keys.length) return res.status(400).json({ error: 'No hay campos válidos para actualizar' });

      const set = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
      const r = await db.query(
        `UPDATE ${tabla} SET ${set}
         WHERE id = $${keys.length + 1} AND usuario_id = $${keys.length + 2} RETURNING *`,
        [...keys.map((k) => data[k]), req.params.id, usuarioId(req)]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
      res.json(r.rows[0]);
    } catch (err) { responderError(res, err); }
  });

  app.delete(`${base}/:id`, async (req, res) => {
    try {
      const r = await db.query(
        `DELETE FROM ${tabla} WHERE id = $1 AND usuario_id = $2 RETURNING id`,
        [req.params.id, usuarioId(req)]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
      res.json({ mensaje: 'Eliminado', id: r.rows[0].id });
    } catch (err) { responderError(res, err); }
  });
}

// ---------------------------------------------------------------
// MATERIAS
// ---------------------------------------------------------------
crud('materias', 'materias', (b, esNueva) => {
  const out = { ...b };
  if (out.estado) out.estado = String(out.estado).toLowerCase();
  if (out.modalidad_aprobacion) out.modalidad_aprobacion = String(out.modalidad_aprobacion).toLowerCase();
  if (esNueva) {
    out.cuatrimestre = out.cuatrimestre || 'Anual'; // respeta 'Anual' con mayúscula
    out.estado = out.estado || 'pendiente';
    out.asistencia_minima = out.asistencia_minima || 75;
  }
  return out;
}, false);

// Importación masiva del plan de estudios: { lista: [{ nombre, anio_carrera, cuatrimestre }] }
app.post('/api/materias/importar', async (req, res) => {
  try {
    const lista = Array.isArray(req.body.lista) ? req.body.lista : [];
    const creadas = [];
    for (const it of lista) {
      if (!it.nombre) continue;
      const r = await insertar('materias', {
        usuario_id: usuarioId(req),
        nombre: it.nombre,
        anio_carrera: it.anio_carrera || 1,
        cuatrimestre: it.cuatrimestre || '1ro',
        estado: 'pendiente',
        asistencia_minima: 75
      });
      creadas.push(r.rows[0]);
    }
    res.status(201).json(creadas);
  } catch (err) { responderError(res, err); }
});

// ---------------------------------------------------------------
// HORARIOS  (la columna real es dia_semana, no "dia")
// ---------------------------------------------------------------
crud('horarios', 'horarios', (b) => ({
  ...b,
  dia_semana: b.dia_semana ?? b.dia
}));

// ---------------------------------------------------------------
// EXÁMENES (parciales / finales)
// ---------------------------------------------------------------
crud('examenes', 'examenes');

// ---------------------------------------------------------------
// TRABAJOS PRÁCTICOS  (la ruta es /api/tps, la tabla trabajos_practicos)
// ---------------------------------------------------------------
crud('tps', 'trabajos_practicos');

// ---------------------------------------------------------------
// CORRELATIVAS (clave compuesta materia_id + correlativa_id)
// ---------------------------------------------------------------
app.get('/api/correlativas', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*, m.nombre AS materia_nombre,
              r.nombre AS correlativa_nombre, r.estado AS correlativa_estado
       FROM correlativas c
       JOIN materias m ON m.id = c.materia_id
       JOIN materias r ON r.id = c.correlativa_id
       WHERE m.usuario_id = $1`,
      [usuarioId(req)]
    );
    res.json(r.rows);
  } catch (err) { responderError(res, err); }
});

app.post('/api/correlativas', async (req, res) => {
  try {
    const body = { ...req.body, tipo_requisito: req.body.tipo_requisito ?? req.body.condicion };
    const { cols, data } = await datosPermitidos('correlativas', body);
    if (cols.includes('usuario_id')) data.usuario_id = usuarioId(req);
    const r = await insertar('correlativas', data);
    res.status(201).json(r.rows[0]);
  } catch (err) { responderError(res, err); }
});

app.delete('/api/correlativas/:materiaId/:correlativaId', async (req, res) => {
  try {
    const r = await db.query(
      'DELETE FROM correlativas WHERE materia_id = $1 AND correlativa_id = $2 RETURNING *',
      [req.params.materiaId, req.params.correlativaId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ mensaje: 'Eliminado' });
  } catch (err) { responderError(res, err); }
});

// Por si el frontend borra por id (solo funciona si la tabla tiene columna id)
app.delete('/api/correlativas/:id', async (req, res) => {
  try {
    const cols = await columnasDe('correlativas');
    if (!cols.includes('id')) {
      return res.status(400).json({ error: 'Usá /api/correlativas/:materiaId/:correlativaId' });
    }
    const r = await db.query('DELETE FROM correlativas WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ mensaje: 'Eliminado' });
  } catch (err) { responderError(res, err); }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});