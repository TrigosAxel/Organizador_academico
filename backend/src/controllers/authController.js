const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Envío de correos por la API HTTP de Brevo.
// (Render gratis bloquea los puertos SMTP, así que Gmail/nodemailer no funciona ahí.)
const enviarCorreo = async ({ to, subject, html }) => {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: 'Organizador Académico', email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });
  if (!resp.ok) {
    const detalle = await resp.text();
    throw new Error(`Brevo respondió ${resp.status}: ${detalle}`);
  }
};

const generarToken = (usuario) =>
  jwt.sign({ id: usuario.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// '' o undefined -> null (para columnas numéricas y de fecha)
const nn = (v) => (v === '' || v === undefined ? null : v);

// ---------------------------------------------------------------
// REGISTRO
// ---------------------------------------------------------------
const registrarUsuario = async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Completá nombre, correo y contraseña' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const usuarioExistente = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const nuevoUsuario = await pool.query(
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, email, fin_cursada',
      [nombre, email, passwordHash]
    );
    const usuario = nuevoUsuario.rows[0];

    // Ahora también devuelve el token, así el frontend entra directo después de registrarse
    res.status(201).json({
      mensaje: 'Usuario registrado con éxito',
      token: generarToken(usuario),
      usuario
    });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error en el servidor al registrar' });
  }
};

// ---------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------
const loginUsuario = async (req, res) => {
  const { email, password } = req.body;
  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (resultado.rows.length === 0) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    const usuario = resultado.rows[0];
    const passwordAlmacenada = usuario.password_hash || usuario.password;

    if (!passwordAlmacenada) {
      return res.status(400).json({ error: 'La cuenta no tiene una contraseña válida asignada' });
    }

    const passwordValida = await bcrypt.compare(password, passwordAlmacenada);
    if (!passwordValida) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    res.json({
      mensaje: 'Login exitoso',
      token: generarToken(usuario),
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        fin_cursada: usuario.fin_cursada
      }
    });
  } catch (err) {
    console.error('Error detallado en login:', err);
    res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
  }
};

// ---------------------------------------------------------------
// PERFIL (requiere token)
// ---------------------------------------------------------------
const obtenerPerfil = async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, email, fin_cursada FROM usuarios WHERE id = $1',
      [req.usuarioId]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(resultado.rows[0]);
  } catch (err) {
    console.error('Error al obtener perfil:', err);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
};

// ---------------------------------------------------------------
// FIN DE CURSADA (requiere token)
// ---------------------------------------------------------------
const actualizarFinCursada = async (req, res) => {
  try {
    const { fin_cursada } = req.body;
    const resultado = await pool.query(
      'UPDATE usuarios SET fin_cursada = $1 WHERE id = $2 RETURNING id, nombre, email, fin_cursada',
      [nn(fin_cursada) || null, req.usuarioId]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ mensaje: 'Fin de cursada actualizado', usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Error al actualizar fin de cursada:', err);
    res.status(500).json({ error: 'Error al actualizar la fecha de fin de cursada' });
  }
};

// ---------------------------------------------------------------
// MIGRAR DATOS DE INVITADO (requiere token)
// En modo invitado los ids son números inventados (Date.now()), así que
// primero se crean las materias y se arma un mapa id viejo -> id nuevo
// para poder enganchar horarios, exámenes, TPs y correlativas.
// Todo va en una transacción: o se guarda todo o no se guarda nada.
// ---------------------------------------------------------------
const migrarInvitado = async (req, res) => {
  const {
    materias = [],
    horarios = [],
    examenes = [],
    tps = [],
    correlativas = [],
    fin_cursada
  } = req.body || {};
  const uid = req.usuarioId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mapa = new Map(); // id de invitado -> id nuevo en la BD

    for (const m of materias) {
      if (!m.nombre) continue;
      const r = await client.query(
        `INSERT INTO materias
           (usuario_id, nombre, anio_carrera, cuatrimestre, estado, nota_final,
            modalidad_aprobacion, clases_totales, inasistencias, asistencia_minima)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          uid,
          m.nombre,
          m.anio_carrera ?? m.anio ?? 1,
          String(m.cuatrimestre ?? '1ro'),
          m.estado ? String(m.estado).toLowerCase() : 'pendiente',
          nn(m.nota_final),
          m.modalidad_aprobacion ? String(m.modalidad_aprobacion).toLowerCase() : null,
          m.clases_totales ?? 0,
          m.inasistencias ?? 0,
          m.asistencia_minima ?? 75
        ]
      );
      mapa.set(m.id, r.rows[0].id);
    }

    for (const h of horarios) {
      const materiaId = mapa.get(h.materia_id);
      if (!materiaId || !h.dia_semana || !h.hora_inicio || !h.hora_fin) continue;
      await client.query(
        `INSERT INTO horarios (usuario_id, materia_id, dia_semana, hora_inicio, hora_fin, aula)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uid, materiaId, h.dia_semana, h.hora_inicio, h.hora_fin, nn(h.aula)]
      );
    }

    for (const e of examenes) {
      const materiaId = mapa.get(e.materia_id);
      if (!materiaId || !e.titulo || !e.fecha) continue;
      await client.query(
        `INSERT INTO examenes
           (usuario_id, materia_id, titulo, fecha, nota_intento_1, nota_intento_2,
            nota_vigente, condicion, notas_estudio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uid, materiaId, e.titulo, e.fecha,
          nn(e.nota_intento_1), nn(e.nota_intento_2), nn(e.nota_vigente),
          nn(e.condicion), nn(e.notas_estudio)
        ]
      );
    }

    for (const t of tps) {
      const materiaId = mapa.get(t.materia_id);
      if (!materiaId || !t.titulo || !t.fecha_entrega) continue;
      await client.query(
        `INSERT INTO trabajos_practicos
           (usuario_id, materia_id, titulo, fecha_entrega, estado, nota, descripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uid, materiaId, t.titulo, t.fecha_entrega, t.estado || 'pendiente', nn(t.nota), nn(t.descripcion)]
      );
    }

    // La tabla correlativas puede o no tener usuario_id: se revisa antes de insertar
    const infoCol = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'correlativas' AND column_name = 'usuario_id'`
    );
    const conUsuario = infoCol.rows.length > 0;

    for (const c of correlativas) {
      const materiaId = mapa.get(c.materia_id);
      const correlativaId = mapa.get(c.correlativa_id);
      if (!materiaId || !correlativaId) continue;
      if (conUsuario) {
        await client.query(
          `INSERT INTO correlativas (usuario_id, materia_id, correlativa_id, tipo_requisito)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [uid, materiaId, correlativaId, c.tipo_requisito || 'regular']
        );
      } else {
        await client.query(
          `INSERT INTO correlativas (materia_id, correlativa_id, tipo_requisito)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [materiaId, correlativaId, c.tipo_requisito || 'regular']
        );
      }
    }

    if (fin_cursada) {
      await client.query('UPDATE usuarios SET fin_cursada = $1 WHERE id = $2', [fin_cursada, uid]);
    }

    await client.query('COMMIT');
    res.json({ mensaje: 'Datos migrados con éxito', materias_migradas: mapa.size });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al migrar datos de invitado:', err);
    res.status(500).json({ error: 'No se pudieron migrar los datos', detail: err.message });
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------
// RECUPERACIÓN DE CONTRASEÑA
// ---------------------------------------------------------------
const solicitarRecuperacion = async (req, res) => {
  const { email } = req.body;
  // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados
  const respuestaGenerica = {
    mensaje: 'Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva. Revisá también la carpeta de spam.'
  };

  try {
    if (!email) return res.status(400).json({ error: 'Ingresá tu correo electrónico' });

    const usuario = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (usuario.rows.length === 0) {
      return res.json(respuestaGenerica);
    }

    const tokenReseteo = crypto.randomBytes(32).toString('hex');
    const expiracion = new Date(Date.now() + 3600000);

    await pool.query(
      'UPDATE usuarios SET token_reseteo = $1, expira_token = $2 WHERE email = $3',
      [tokenReseteo, expiracion, email]
    );

    const linkRecuperacion = `https://organizador-academico-e5my-green.vercel.app?token=${tokenReseteo}`;

    await enviarCorreo({
      to: email,
      subject: 'Recuperación de contraseña - Organizador Académico',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2>Recuperación de contraseña</h2>
          <p>Pediste restablecer tu contraseña en el Organizador Académico.</p>
          <p>Hacé clic en el siguiente botón para elegir una nueva (el enlace vence en 1 hora):</p>
          <a href="${linkRecuperacion}" style="background: #2563eb; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Crear nueva contraseña</a>
          <p>Si no fuiste vos, ignorá este mensaje: tu contraseña no cambia.</p>
        </div>
      `
    });

    res.json(respuestaGenerica);
  } catch (err) {
    console.error('Error al enviar correo de recuperación:', err);
    res.status(500).json({ error: 'No se pudo enviar el correo de recuperación. Probá de nuevo en unos minutos.' });
  }
};

const resetearPassword = async (req, res) => {
  const { token, nuevaPassword } = req.body;
  try {
    if (!token || !nuevaPassword || nuevaPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const usuario = await pool.query(
      'SELECT * FROM usuarios WHERE token_reseteo = $1 AND expira_token > NOW()',
      [token]
    );
    if (usuario.rows.length === 0) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(nuevaPassword, salt);

    await pool.query(
      'UPDATE usuarios SET password_hash = $1, token_reseteo = NULL, expira_token = NULL WHERE id = $2',
      [passwordHash, usuario.rows[0].id]
    );

    res.json({ mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error al resetear contraseña:', err);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
};

module.exports = {
  registrarUsuario,
  loginUsuario,
  obtenerPerfil,
  actualizarFinCursada,
  migrarInvitado,
  solicitarRecuperacion,
  resetearPassword
};