const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const importador = require('./importador');
const requireAuth = require('./middleware/auth');
const {
  registrarUsuario,
  loginUsuario,
  obtenerPerfil,
  actualizarFinCursada,
  actualizarCarrera,
  actualizarPerfil,
  enviarComentario,
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
// La importación de planes recibe archivos en base64: necesita un límite mayor (va primero)
app.use('/api/importar', requireAuth, express.json({ limit: '12mb' }));
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

const PROTEGIDAS = ['id', 'usuario_id', 'created_at', 'carrera_id'];
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

// Carrera elegida en la petición (?carrera_id=); si no viene, se devuelve todo
const carreraDe = (req) => {
  const n = Number(req.query.carrera_id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Devuelve las carreras del usuario; si no tiene ninguna, crea la primera
async function asegurarCarreras(uid) {
  const r = await db.query('SELECT * FROM carreras WHERE usuario_id = $1 ORDER BY id', [uid]);
  if (r.rows.length) return r.rows;
  const u = await db.query('SELECT * FROM usuarios WHERE id = $1', [uid]);
  const x = u.rows[0] || {};
  const nueva = await db.query(
    'INSERT INTO carreras (usuario_id, nombre, universidad, anio_ingreso, cuatrimestre_actual) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [uid, x.carrera || 'Mi carrera', x.universidad || null, x.anio_ingreso || null, x.cuatrimestre_actual || null]
  );
  await db.query('UPDATE materias SET carrera_id = $1 WHERE usuario_id = $2 AND carrera_id IS NULL', [nueva.rows[0].id, uid]);
  return nueva.rows;
}

// Si la carrera pedida es del usuario, se usa; si no, la primera que tenga
async function carreraValida(uid, pedida) {
  const carreras = await asegurarCarreras(uid);
  const n = Number(pedida);
  const encontrada = carreras.find((c) => c.id === n);
  return (encontrada || carreras[0]).id;
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
// modo: 'join' (tabla con materia_id), 'propia' (tabla con carrera_id) o 'ninguno'
function crud(ruta, tabla, normalizar = (b) => b, modo = 'join') {
  const base = `/api/${ruta}`;

  app.get(base, async (req, res) => {
    try {
      // El frontend espera materia_nombre en horarios, exámenes y TPs
      const carrera = carreraDe(req);
      let r;
      if (modo === 'join') {
        r = await db.query(
          `SELECT t.*, m.nombre AS materia_nombre FROM ${tabla} t
           JOIN materias m ON m.id = t.materia_id
           WHERE t.usuario_id = $1 AND ($2::int IS NULL OR m.carrera_id = $2) ORDER BY t.id`,
          [usuarioId(req), carrera]
        );
      } else if (modo === 'propia') {
        r = await db.query(
          `SELECT * FROM ${tabla} WHERE usuario_id = $1 AND ($2::int IS NULL OR carrera_id = $2) ORDER BY id`,
          [usuarioId(req), carrera]
        );
      } else {
        r = await db.query(`SELECT * FROM ${tabla} WHERE usuario_id = $1 ORDER BY id`, [usuarioId(req)]);
      }
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
async function borrarMaterias(uid, materiaId = null, carreraId = null) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = materiaId
      ? await client.query('SELECT id FROM materias WHERE usuario_id = $1 AND id = $2', [uid, materiaId])
      : await client.query(
          'SELECT id FROM materias WHERE usuario_id = $1 AND ($2::int IS NULL OR carrera_id = $2)',
          [uid, carreraId]
        );
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
    const n = await borrarMaterias(usuarioId(req), null, carreraDe(req));
    res.json({ mensaje: 'Materias eliminadas', eliminadas: n });
  } catch (err) { responderError(res, err); }
});

function normalizarMateria(b, esNueva) {
  const out = { ...b };
  if (out.estado) out.estado = String(out.estado).toLowerCase();
  if (out.modalidad_aprobacion) out.modalidad_aprobacion = String(out.modalidad_aprobacion).toLowerCase();
  if (esNueva) {
    out.cuatrimestre = out.cuatrimestre || 'Anual'; // respeta 'Anual' con mayúscula
    out.estado = out.estado || 'pendiente';
    out.asistencia_minima = out.asistencia_minima || 75;
  }
  return out;
}

// Crear una materia: va a la carrera elegida (o a la primera del usuario)
app.post('/api/materias', async (req, res) => {
  try {
    const uid = usuarioId(req);
    const carreraId = await carreraValida(uid, req.body.carrera_id);
    const { data } = await datosPermitidos('materias', normalizarMateria(req.body, true));
    data.usuario_id = uid;
    data.carrera_id = carreraId;
    const r = await insertar('materias', data);
    res.status(201).json(r.rows[0]);
  } catch (err) { responderError(res, err); }
});

crud('materias', 'materias', normalizarMateria, 'propia');

// ---------------------------------------------------------------
// IMPORTACIÓN DEL PLAN DE ESTUDIOS
// 1) /api/importar/analizar  lee un archivo o un texto y devuelve la lista para revisar
// 2) /api/materias/importar  crea las materias (y sus correlativas) en la carrera elegida
// ---------------------------------------------------------------
app.post('/api/importar/analizar', async (req, res) => {
  try {
    const { nombre, contenido, texto } = req.body || {};
    let materias;
    if (typeof texto === 'string' && texto.trim()) {
      materias = importador.interpretarTexto(texto);
    } else if (typeof contenido === 'string' && contenido.length > 0) {
      const buffer = Buffer.from(contenido, 'base64');
      if (buffer.length > 8 * 1024 * 1024) {
        return res.status(413).json({ error: 'El archivo es muy pesado (máximo 8 MB)' });
      }
      materias = await importador.analizarArchivo(String(nombre || ''), buffer);
    } else {
      return res.status(400).json({ error: 'Subí un archivo o pegá el texto del plan' });
    }

    if (!materias.length) {
      return res.status(422).json({
        error: 'No encontré materias en ese contenido. Probá pegar el texto del plan, una materia por línea.'
      });
    }
    res.json({ materias });
  } catch (err) {
    if (err.codigo === 'ARCHIVO') return res.status(400).json({ error: err.message });
    if (err.codigo === 'FALTA_LIBRERIA') return res.status(501).json({ error: err.message });
    console.error('Error al analizar el plan:', err);
    res.status(500).json({ error: 'No se pudo leer el archivo' });
  }
});

app.post('/api/materias/importar', async (req, res) => {
  const lista = Array.isArray(req.body.lista) ? req.body.lista.slice(0, 200) : [];
  const uid = usuarioId(req);
  const client = await db.connect();
  try {
    const carreraId = await carreraValida(uid, req.body.carrera_id);
    await client.query('BEGIN');

    const existentes = await client.query('SELECT id, nombre FROM materias WHERE usuario_id = $1 AND carrera_id = $2', [uid, carreraId]);
    const porNombre = new Map(existentes.rows.map((m) => [importador.norm(m.nombre), m.id]));
    const porCodigo = new Map();

    const creadas = [];
    const omitidas = [];
    for (const it of lista) {
      const nombre = String(it.nombre || '').trim().slice(0, 120);
      if (!nombre) continue;
      const clave = importador.norm(nombre);
      if (porNombre.has(clave)) {
        omitidas.push(nombre);
        if (it.codigo) porCodigo.set(String(it.codigo), porNombre.get(clave));
        continue;
      }
      const cuatri = ['1ro', '2do', 'Anual'].includes(it.cuatrimestre) ? it.cuatrimestre : '1ro';
      const anio = Math.min(6, Math.max(1, Number(it.anio_carrera ?? it.anio) || 1));
      const r = await client.query(
        `INSERT INTO materias (usuario_id, carrera_id, nombre, anio_carrera, cuatrimestre, estado, asistencia_minima)
         VALUES ($1, $2, $3, $4, $5, 'pendiente', 75) RETURNING *`,
        [uid, carreraId, nombre, anio, cuatri]
      );
      porNombre.set(clave, r.rows[0].id);
      if (it.codigo) porCodigo.set(String(it.codigo), r.rows[0].id);
      creadas.push(r.rows[0]);
    }

    // Correlativas: se resuelven por código o por nombre entre las materias de esa carrera
    const infoCol = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'correlativas' AND column_name = 'usuario_id'`
    );
    const conUsuario = infoCol.rows.length > 0;
    let vinculadas = 0;
    const sinResolver = [];
    for (const it of lista) {
      const destino = porNombre.get(importador.norm(it.nombre || ''));
      if (!destino || !Array.isArray(it.correlativas)) continue;
      for (const ref of it.correlativas) {
        const texto = String(ref || '').trim();
        if (!texto) continue;
        let origen = porCodigo.get(texto) || porNombre.get(importador.norm(texto));
        if (!origen) {
          const parecidas = [...porNombre.entries()].filter(([k]) => k.startsWith(importador.norm(texto)));
          if (parecidas.length === 1) origen = parecidas[0][1];
        }
        if (!origen || origen === destino) {
          sinResolver.push(`${it.nombre} → ${texto}`);
          continue;
        }
        await client.query('DELETE FROM correlativas WHERE materia_id = $1 AND correlativa_id = $2', [destino, origen]);
        if (conUsuario) {
          await client.query(
            'INSERT INTO correlativas (usuario_id, materia_id, correlativa_id, tipo_requisito) VALUES ($1, $2, $3, $4)',
            [uid, destino, origen, 'regular']
          );
        } else {
          await client.query(
            'INSERT INTO correlativas (materia_id, correlativa_id, tipo_requisito) VALUES ($1, $2, $3)',
            [destino, origen, 'regular']
          );
        }
        vinculadas++;
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ creadas: creadas.length, omitidas, correlativas: vinculadas, sin_resolver: sinResolver });
  } catch (err) {
    await client.query('ROLLBACK');
    responderError(res, err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// CARRERAS (un usuario puede tener varias)
// ---------------------------------------------------------------
function validarCarrera(body, parcial = false) {
  const datos = {};
  if (!parcial || 'nombre' in body) {
    const nombre = String(body.nombre || '').trim().slice(0, 120);
    if (!nombre) return { error: 'La carrera necesita un nombre' };
    datos.nombre = nombre;
  }
  if ('universidad' in body) datos.universidad = String(body.universidad || '').trim().slice(0, 120) || null;
  if ('cuatrimestre_actual' in body) datos.cuatrimestre_actual = String(body.cuatrimestre_actual || '').trim().slice(0, 30) || null;
  if ('anio_ingreso' in body) {
    if (body.anio_ingreso === null || body.anio_ingreso === '') datos.anio_ingreso = null;
    else {
      const a = Number(body.anio_ingreso);
      if (!Number.isInteger(a) || a < 1950 || a > new Date().getFullYear() + 1) return { error: 'El año de ingreso no es válido' };
      datos.anio_ingreso = a;
    }
  }
  return { datos };
}

app.get('/api/carreras', async (req, res) => {
  try {
    res.json(await asegurarCarreras(usuarioId(req)));
  } catch (err) { responderError(res, err); }
});

app.post('/api/carreras', async (req, res) => {
  try {
    const uid = usuarioId(req);
    const { datos, error } = validarCarrera(req.body || {});
    if (error) return res.status(400).json({ error });
    const actuales = await asegurarCarreras(uid);
    if (actuales.length >= 10) return res.status(400).json({ error: 'Llegaste al máximo de 10 carreras' });
    datos.usuario_id = uid;
    const r = await insertar('carreras', datos);
    res.status(201).json(r.rows[0]);
  } catch (err) { responderError(res, err); }
});

app.put('/api/carreras/:id', async (req, res) => {
  try {
    const { datos, error } = validarCarrera(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(datos);
    if (!keys.length) return res.status(400).json({ error: 'No hay cambios para guardar' });
    const set = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const r = await db.query(
      `UPDATE carreras SET ${set} WHERE id = $${keys.length + 1} AND usuario_id = $${keys.length + 2} RETURNING *`,
      [...keys.map((k) => datos[k]), req.params.id, usuarioId(req)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(r.rows[0]);
  } catch (err) { responderError(res, err); }
});

// Borrar una carrera borra también sus materias (y horarios, exámenes, TPs y correlativas)
app.delete('/api/carreras/:id', async (req, res) => {
  try {
    const uid = usuarioId(req);
    const carreras = await asegurarCarreras(uid);
    const id = Number(req.params.id);
    if (!carreras.some((c) => c.id === id)) return res.status(404).json({ error: 'No encontrada' });
    if (carreras.length === 1) return res.status(400).json({ error: 'Tenés que tener al menos una carrera' });
    await borrarMaterias(uid, null, id);
    await db.query('DELETE FROM carreras WHERE id = $1 AND usuario_id = $2', [id, uid]);
    res.json({ mensaje: 'Carrera eliminada' });
  } catch (err) { responderError(res, err); }
});

// ---------------------------------------------------------------
// NOTAS DEL CALENDARIO (comentarios sobre cualquier día)
// ---------------------------------------------------------------
crud('notas', 'notas_calendario', (b) => {
  const out = { ...b };
  if (typeof out.texto === 'string') out.texto = out.texto.trim().slice(0, 500);
  return out;
}, 'ninguno');

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
       WHERE m.usuario_id = $1 AND ($2::int IS NULL OR m.carrera_id = $2)`,
      [usuarioId(req), carreraDe(req)]
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

// Comentarios para los desarrolladores
app.post('/api/comentarios', enviarComentario);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});