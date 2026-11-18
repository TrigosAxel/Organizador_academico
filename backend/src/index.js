const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const requireAuth = require('./middleware/auth');
const {
  registrarUsuario,
  loginUsuario,
  obtenerPerfil,
  actualizarFinCursada,
  actualizarCarrera,
  actualizarPerfil,
  cambiarPassword,
  migrarInvitado,
  solicitarRecuperacion,
  resetearPassword
} = require('./controllers/authController');

const app = express();
const PORT = process.env.PORT || 4000;

if (!process.env.JWT_SECRET) {
  console.error('Falta la variable de entorno JWT_SECRET. El servidor no puede iniciar.');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------
// Rutas públicas
app.post('/api/auth/register', registrarUsuario);
app.post('/api/auth/login', loginUsuario);
app.post('/api/auth/recuperar', solicitarRecuperacion);
app.post('/api/auth/reset-password', resetearPassword);

// Rutas que requieren token
app.get('/api/auth/me', requireAuth, obtenerPerfil);
app.put('/api/auth/fin-cursada', requireAuth, actualizarFinCursada);
app.put('/api/auth/carrera', requireAuth, actualizarCarrera);
app.put('/api/auth/perfil', requireAuth, actualizarPerfil);
app.put('/api/auth/password', requireAuth, cambiarPassword);
app.post('/api/auth/migrar-invitado', requireAuth, migrarInvitado);

// Todo lo que se define de acá para abajo (materias, horarios, etc.) exige token
app.use('/api', requireAuth);

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------

// El id sale del token JWT (lo carga el middleware requireAuth)
const usuarioId = (req) => req.usuarioId;

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

// Borra una materia (o todas las del usuario) junto con lo que depende de ellas:
// correlativas, horarios, exámenes y TPs. Todo en una transacción.
// Se registra ANTES que crud('materias') para que estas rutas tengan prioridad.
async function borrarMaterias(uid, materiaId = null) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = materiaId
      ? await client.query('SELECT id FROM materias WHERE usuario_id = $1 AND id = $2', [uid, materiaId])
      : await client.query('SELECT id FROM materias WHERE usuario_id = $1', [uid]);
    const ids = r.rows.map((x) => x.id);
    if (ids.length) {
      await client.query('DELETE FROM correlativas WHERE materia_id = ANY($1) OR correlativa_id = ANY($1)', [ids]);
      await client.query('DELETE FROM horarios WHERE materia_id = ANY($1)', [ids]);
      await client.query('DELETE FROM examenes WHERE materia_id = ANY($1)', [ids]);
      await client.query('DELETE FROM trabajos_practicos WHERE materia_id = ANY($1)', [ids]);
      await client.query('DELETE FROM materias WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
    return ids.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

app.delete('/api/materias/:id', async (req, res) => {
  try {
    const n = await borrarMaterias(usuarioId(req), req.params.id);
    if (!n) return res.status(404).json({ error: 'No encontrado' });
    res.json({ mensaje: 'Eliminada' });
  } catch (err) { responderError(res, err); }
});

// Resetear: borra TODAS las materias del usuario (y lo que depende de ellas)
app.delete('/api/materias', async (req, res) => {
  try {
    const n = await borrarMaterias(usuarioId(req));
    res.json({ mensaje: 'Materias eliminadas', eliminadas: n });
  } catch (err) { responderError(res, err); }
});

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
// "intentos" es una lista de notas (jsonb), sin límite de cantidad.
// Se mantienen sincronizadas nota_intento_1 y nota_intento_2 por compatibilidad.
crud('examenes', 'examenes', (b) => {
  const out = { ...b };
  if (Array.isArray(b.intentos)) {
    const lista = b.intentos.map((n) => (n === '' || n === null || n === undefined || Number.isNaN(Number(n)) ? null : Number(n)));
    out.intentos = JSON.stringify(lista);
    out.nota_intento_1 = lista[0] ?? null;
    out.nota_intento_2 = lista[1] ?? null;
  }
  return out;
});

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
    const uid = usuarioId(req);
    const tipo = req.body.tipo_requisito ?? req.body.condicion ?? 'regular';

    // Varias correlativas de una sola vez: { materia_id, correlativa_ids: [..], tipo_requisito }
    if (Array.isArray(req.body.correlativa_ids)) {
      const materiaId = Number(req.body.materia_id);
      const ids = [...new Set(req.body.correlativa_ids.map(Number))].filter(
        (n) => Number.isInteger(n) && n !== materiaId
      );
      if (!materiaId || !ids.length) {
        return res.status(400).json({ error: 'Elegí la materia y al menos una correlativa' });
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Solo se aceptan materias que pertenecen al usuario
        const propias = await client.query(
          'SELECT id FROM materias WHERE usuario_id = $1 AND id = ANY($2)',
          [uid, [materiaId, ...ids]]
        );
        const validos = new Set(propias.rows.map((r) => r.id));
        if (!validos.has(materiaId)) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Materia no encontrada' });
        }
        const aInsertar = ids.filter((id) => validos.has(id));

        const cols = await columnasDe('correlativas');
        const conUsuario = cols.includes('usuario_id');

        // Si ya existía el vínculo, se reemplaza (así se puede cambiar la condición)
        await client.query(
          'DELETE FROM correlativas WHERE materia_id = $1 AND correlativa_id = ANY($2)',
          [materiaId, aInsertar]
        );
        for (const cid of aInsertar) {
          if (conUsuario) {
            await client.query(
              'INSERT INTO correlativas (usuario_id, materia_id, correlativa_id, tipo_requisito) VALUES ($1, $2, $3, $4)',
              [uid, materiaId, cid, tipo]
            );
          } else {
            await client.query(
              'INSERT INTO correlativas (materia_id, correlativa_id, tipo_requisito) VALUES ($1, $2, $3)',
              [materiaId, cid, tipo]
            );
          }
        }

        await client.query('COMMIT');
        return res.status(201).json({ mensaje: 'Correlativas vinculadas', cantidad: aInsertar.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Una sola correlativa (formato anterior)
    const body = { ...req.body, tipo_requisito: tipo };
    const { cols, data } = await datosPermitidos('correlativas', body);
    if (cols.includes('usuario_id')) data.usuario_id = uid;
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