const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_organizador_academico_2026';

const verificarToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token no proporcionado' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuarioId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

// ==================== AUTH ====================
app.post('/api/auth/register', async (req, res) => {
  const { nombre, email, password } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Completá todos los campos' });
  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Ese correo ya está registrado' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, email, fin_cursada',
      [nombre.trim(), email.toLowerCase().trim(), passwordHash]
    );
    const usuario = result.rows[0];
    const token = jwt.sign({ id: usuario.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, usuario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email.toLowerCase().trim()]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Correo o contraseña incorrectos' });

    const usuario = result.rows[0];
    const valida = await bcrypt.compare(password, usuario.password_hash);
    if (!valida) return res.status(400).json({ error: 'Correo o contraseña incorrectos' });

    const token = jwt.sign({ id: usuario.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, fin_cursada: usuario.fin_cursada },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', verificarToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, email, fin_cursada FROM usuarios WHERE id = $1', [req.usuarioId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/fin-cursada', verificarToken, async (req, res) => {
  const { fin_cursada } = req.body;
  try {
    const result = await pool.query(
      'UPDATE usuarios SET fin_cursada = $1 WHERE id = $2 RETURNING fin_cursada',
      [fin_cursada || null, req.usuarioId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MATERIAS ====================
app.get('/api/materias', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM materias WHERE usuario_id = $1 ORDER BY anio_carrera ASC, cuatrimestre ASC, nombre ASC',
      [req.usuarioId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/materias', verificarToken, async (req, res) => {
  const { nombre, anio_carrera, cuatrimestre, estado, nota_final, modalidad_aprobacion, asistencia_minima } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO materias (usuario_id, nombre, anio_carrera, cuatrimestre, estado, nota_final, modalidad_aprobacion, asistencia_minima)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.usuarioId,
        nombre,
        anio_carrera,
        cuatrimestre,
        estado || 'pendiente',
        estado === 'aprobada' ? nota_final || null : null,
        estado === 'aprobada' ? modalidad_aprobacion || 'final' : null,
        asistencia_minima ?? 75,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Importación masiva de plan de estudios
app.post('/api/materias/importar', verificarToken, async (req, res) => {
  const { lista } = req.body;
  if (!Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: 'Lista vacía' });
  }
  try {
    const insertadas = [];
    for (const item of lista) {
      if (!item.nombre) continue;
      const r = await pool.query(
        `INSERT INTO materias (usuario_id, nombre, anio_carrera, cuatrimestre, estado)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          req.usuarioId,
          item.nombre.trim(),
          Math.min(6, Math.max(1, Number(item.anio_carrera) || 1)),
          ['1ro', '2do', 'Anual'].includes(item.cuatrimestre) ? item.cuatrimestre : '1ro',
          'pendiente',
        ]
      );
      insertadas.push(r.rows[0]);
    }
    res.status(201).json(insertadas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/materias/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const {
    nombre,
    anio_carrera,
    cuatrimestre,
    estado,
    nota_final,
    modalidad_aprobacion,
    clases_totales,
    inasistencias,
    asistencia_minima,
  } = req.body;
  try {
    const result = await pool.query(
      `UPDATE materias 
       SET nombre = $1, anio_carrera = $2, cuatrimestre = $3, estado = $4, nota_final = $5,
           modalidad_aprobacion = $6, clases_totales = $7, inasistencias = $8, asistencia_minima = $9
       WHERE id = $10 AND usuario_id = $11 RETURNING *`,
      [
        nombre,
        anio_carrera,
        cuatrimestre,
        estado,
        estado === 'aprobada' ? nota_final || null : null,
        estado === 'aprobada' ? modalidad_aprobacion || 'final' : null,
        clases_totales ?? 0,
        inasistencias ?? 0,
        asistencia_minima ?? 75,
        id,
        req.usuarioId,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Materia no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/materias/:id', verificarToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM materias WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuarioId]);
    res.json({ mensaje: 'Materia eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== HORARIOS ====================
app.get('/api/horarios', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*, m.nombre AS materia_nombre
       FROM horarios h
       JOIN materias m ON h.materia_id = m.id
       WHERE h.usuario_id = $1
       ORDER BY h.hora_inicio ASC`,
      [req.usuarioId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/horarios', verificarToken, async (req, res) => {
  const { materia_id, dia_semana, hora_inicio, hora_fin, aula } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO horarios (usuario_id, materia_id, dia_semana, hora_inicio, hora_fin, aula)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.usuarioId, materia_id, dia_semana, hora_inicio, hora_fin, aula || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/horarios/:id', verificarToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM horarios WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuarioId]);
    res.json({ mensaje: 'Horario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CORRELATIVAS ====================
app.get('/api/correlativas', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.materia_id, c.correlativa_id, c.tipo_requisito,
              m.nombre AS materia_nombre, req.nombre AS correlativa_nombre, req.estado AS correlativa_estado
       FROM correlativas c
       JOIN materias m ON c.materia_id = m.id
       JOIN materias req ON c.correlativa_id = req.id
       WHERE m.usuario_id = $1 ORDER BY m.nombre ASC`,
      [req.usuarioId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/correlativas', verificarToken, async (req, res) => {
  const { materia_id, correlativa_id, tipo_requisito } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO correlativas (materia_id, correlativa_id, tipo_requisito) VALUES ($1, $2, $3) RETURNING *`,
      [materia_id, correlativa_id, tipo_requisito || 'regular']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/correlativas/:materia_id/:correlativa_id', verificarToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM correlativas WHERE materia_id = $1 AND correlativa_id = $2', [
      req.params.materia_id,
      req.params.correlativa_id,
    ]);
    res.json({ mensaje: 'Correlativa eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXÁMENES ====================
app.get('/api/examenes', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, m.nombre AS materia_nombre
       FROM examenes e JOIN materias m ON e.materia_id = m.id
       WHERE e.usuario_id = $1 ORDER BY e.fecha ASC`,
      [req.usuarioId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/examenes', verificarToken, async (req, res) => {
  const { materia_id, titulo, fecha, notas_estudio } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO examenes (usuario_id, materia_id, titulo, fecha, notas_estudio)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.usuarioId, materia_id, titulo, fecha, notas_estudio || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/examenes/:id', verificarToken, async (req, res) => {
  const { nota_intento_1, nota_intento_2, condicion } = req.body;
  const n1 = nota_intento_1 !== '' && nota_intento_1 !== null && nota_intento_1 !== undefined ? Number(nota_intento_1) : null;
  const n2 = nota_intento_2 !== '' && nota_intento_2 !== null && nota_intento_2 !== undefined ? Number(nota_intento_2) : null;
  let notaVigente = null;
  if (n1 !== null && n2 !== null) notaVigente = Math.max(n1, n2);
  else if (n1 !== null) notaVigente = n1;
  else if (n2 !== null) notaVigente = n2;

  try {
    const result = await pool.query(
      `UPDATE examenes SET nota_intento_1 = $1, nota_intento_2 = $2, nota_vigente = $3, condicion = $4
       WHERE id = $5 AND usuario_id = $6 RETURNING *`,
      [n1, n2, notaVigente, condicion || 'pendiente', req.params.id, req.usuarioId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/examenes/:id', verificarToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM examenes WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuarioId]);
    res.json({ mensaje: 'Examen eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TRABAJOS PRÁCTICOS ====================
app.get('/api/tps', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tp.*, m.nombre AS materia_nombre
       FROM trabajos_practicos tp JOIN materias m ON tp.materia_id = m.id
       WHERE tp.usuario_id = $1 ORDER BY tp.fecha_entrega ASC`,
      [req.usuarioId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tps', verificarToken, async (req, res) => {
  const { materia_id, titulo, fecha_entrega, descripcion } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO trabajos_practicos (usuario_id, materia_id, titulo, fecha_entrega, descripcion)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.usuarioId, materia_id, titulo, fecha_entrega, descripcion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tps/:id', verificarToken, async (req, res) => {
  const { estado, nota } = req.body;
  try {
    const result = await pool.query(
      `UPDATE trabajos_practicos SET estado = $1, nota = $2 WHERE id = $3 AND usuario_id = $4 RETURNING *`,
      [estado, nota !== '' && nota !== null ? Number(nota) : null, req.params.id, req.usuarioId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tps/:id', verificarToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM trabajos_practicos WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuarioId]);
    res.json({ mensaje: 'TP eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==================== MIGRACIÓN DESDE MODO INVITADO ====================
app.post('/api/auth/migrar-invitado', verificarToken, async (req, res) => {
  const { materias = [], horarios = [], examenes = [], tps = [], correlativas = [], fin_cursada } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (fin_cursada) {
      await client.query('UPDATE usuarios SET fin_cursada = $1 WHERE id = $2', [fin_cursada, req.usuarioId]);
    }

    // Mapeamos los IDs temporales (Date.now()) a los nuevos IDs reales de PostgreSQL
    const mapaIdsMaterias = new Map();

    for (const m of materias) {
      const r = await client.query(
        `INSERT INTO materias (
          usuario_id, nombre, anio_carrera, cuatrimestre, estado, nota_final,
          modalidad_aprobacion, clases_totales, inasistencias, asistencia_minima
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          req.usuarioId,
          m.nombre,
          m.anio_carrera,
          m.cuatrimestre,
          m.estado || 'pendiente',
          m.estado === 'aprobada' ? m.nota_final || null : null,
          m.estado === 'aprobada' ? m.modalidad_aprobacion || 'final' : null,
          m.clases_totales ?? 0,
          m.inasistencias ?? 0,
          m.asistencia_minima ?? 75,
        ]
      );
      mapaIdsMaterias.set(m.id, r.rows[0].id);
    }

    for (const h of horarios) {
      const nuevoMatId = mapaIdsMaterias.get(h.materia_id);
      if (!nuevoMatId) continue;
      await client.query(
        `INSERT INTO horarios (usuario_id, materia_id, dia_semana, hora_inicio, hora_fin, aula)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.usuarioId, nuevoMatId, h.dia_semana, h.hora_inicio, h.hora_fin, h.aula || null]
      );
    }

    for (const ex of examenes) {
      const nuevoMatId = mapaIdsMaterias.get(ex.materia_id);
      if (!nuevoMatId) continue;
      await client.query(
        `INSERT INTO examenes (
          usuario_id, materia_id, titulo, fecha, nota_intento_1, nota_intento_2, nota_vigente, condicion, notas_estudio
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.usuarioId,
          nuevoMatId,
          ex.titulo,
          ex.fecha,
          ex.nota_intento_1 ?? null,
          ex.nota_intento_2 ?? null,
          ex.nota_vigente ?? null,
          ex.condicion || 'pendiente',
          ex.notas_estudio || null,
        ]
      );
    }

    for (const tp of tps) {
      const nuevoMatId = mapaIdsMaterias.get(tp.materia_id);
      if (!nuevoMatId) continue;
      await client.query(
        `INSERT INTO trabajos_practicos (usuario_id, materia_id, titulo, fecha_entrega, estado, nota, descripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.usuarioId, nuevoMatId, tp.titulo, tp.fecha_entrega, tp.estado || 'pendiente', tp.nota ?? null, tp.descripcion || null]
      );
    }

    for (const c of correlativas) {
      const nuevoMatId = mapaIdsMaterias.get(c.materia_id);
      const nuevoReqId = mapaIdsMaterias.get(c.correlativa_id);
      if (!nuevoMatId || !nuevoReqId) continue;
      await client.query(
        `INSERT INTO correlativas (materia_id, correlativa_id, tipo_requisito)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [nuevoMatId, nuevoReqId, c.tipo_requisito || 'regular']
      );
    }

    await client.query('COMMIT');
    res.json({ mensaje: 'Datos migrados correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));