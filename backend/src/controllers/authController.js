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

// Datos del usuario que se le devuelven al frontend (nunca el hash de la contraseña).
// Usa ?? null para que no falle aunque alguna columna opcional todavía no exista.
const usuarioPublico = (u) => ({
  id: u.id,
  nombre: u.nombre,
  email: u.email,
  fin_cursada: u.fin_cursada ?? null,
  carrera: u.carrera ?? null,
  foto: u.foto ?? null,
  apellido: u.apellido ?? null,
  universidad: u.universidad ?? null,
  anio_ingreso: u.anio_ingreso ?? null,
  cuatrimestre_actual: u.cuatrimestre_actual ?? null
});

// La foto se guarda como imagen chica en base64 (el frontend la reduce a 256x256)
const FOTO_VALIDA = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

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
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [nombre, email, passwordHash]
    );
    const usuario = nuevoUsuario.rows[0];

    // Ahora también devuelve el token, así el frontend entra directo después de registrarse
    res.status(201).json({
      mensaje: 'Usuario registrado con éxito',
      token: generarToken(usuario),
      usuario: usuarioPublico(usuario)
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
      usuario: usuarioPublico(usuario)
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
    const resultado = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(usuarioPublico(resultado.rows[0]));
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
      'UPDATE usuarios SET fin_cursada = $1 WHERE id = $2 RETURNING *',
      [nn(fin_cursada) || null, req.usuarioId]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ mensaje: 'Fin de cursada actualizado', usuario: usuarioPublico(resultado.rows[0]) });
  } catch (err) {
    console.error('Error al actualizar fin de cursada:', err);
    res.status(500).json({ error: 'Error al actualizar la fecha de fin de cursada' });
  }
};

// ---------------------------------------------------------------
// CARRERA (requiere token)
// ---------------------------------------------------------------
const actualizarCarrera = async (req, res) => {
  try {
    const carrera = String(req.body.carrera || '').trim().slice(0, 120);
    const resultado = await pool.query(
      'UPDATE usuarios SET carrera = $1 WHERE id = $2 RETURNING *',
      [carrera || null, req.usuarioId]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ mensaje: 'Carrera actualizada', usuario: usuarioPublico(resultado.rows[0]) });
  } catch (err) {
    console.error('Error al actualizar carrera:', err);
    res.status(500).json({ error: 'Error al guardar la carrera' });
  }
};

// ---------------------------------------------------------------
// PERFIL: nombre, carrera y foto (requiere token)
// Solo se modifican los campos que vienen en la petición.
// ---------------------------------------------------------------
const actualizarPerfil = async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const valores = [];
    const agregar = (columna, valor) => {
      valores.push(valor);
      sets.push(`${columna} = $${valores.length}`);
    };

    if ('nombre' in body) {
      const nombre = String(body.nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      agregar('nombre', nombre.slice(0, 80));
    }

    if ('carrera' in body) {
      agregar('carrera', String(body.carrera || '').trim().slice(0, 120) || null);
    }

    if ('apellido' in body) {
      agregar('apellido', String(body.apellido || '').trim().slice(0, 80) || null);
    }

    if ('universidad' in body) {
      agregar('universidad', String(body.universidad || '').trim().slice(0, 120) || null);
    }

    if ('anio_ingreso' in body) {
      if (body.anio_ingreso === null || body.anio_ingreso === '') {
        agregar('anio_ingreso', null);
      } else {
        const anio = Number(body.anio_ingreso);
        if (!Number.isInteger(anio) || anio < 1950 || anio > new Date().getFullYear() + 1) {
          return res.status(400).json({ error: 'El año de ingreso no es válido' });
        }
        agregar('anio_ingreso', anio);
      }
    }

    if ('cuatrimestre_actual' in body) {
      agregar('cuatrimestre_actual', String(body.cuatrimestre_actual || '').trim().slice(0, 30) || null);
    }

    if ('foto' in body) {
      if (body.foto === null) {
        agregar('foto', null);
      } else if (typeof body.foto === 'string' && body.foto.length <= 400000 && FOTO_VALIDA.test(body.foto)) {
        agregar('foto', body.foto);
      } else {
        return res.status(400).json({ error: 'La foto no es válida o pesa demasiado' });
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'No hay cambios para guardar' });

    valores.push(req.usuarioId);
    const resultado = await pool.query(
      `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${valores.length} RETURNING *`,
      valores
    );
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ mensaje: 'Perfil actualizado', usuario: usuarioPublico(resultado.rows[0]) });
  } catch (err) {
    console.error('Error al actualizar perfil:', err);
    if (err.code === '42703') {
      return res.status(500).json({ error: 'Falta una columna en la base de datos. Corré el SQL de migración de AulaTrack en Supabase.' });
    }
    res.status(500).json({ error: 'Error al guardar los cambios del perfil' });
  }
};

// ---------------------------------------------------------------
// COMENTARIOS PARA LOS DESARROLLADORES (requiere token)
// ---------------------------------------------------------------
const TIPOS_COMENTARIO = ['sugerencia', 'error', 'otro'];

const escaparHtml = (texto) =>
  String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const enviarComentario = async (req, res) => {
  try {
    const tipo = TIPOS_COMENTARIO.includes(req.body?.tipo) ? req.body.tipo : 'otro';
    const mensaje = String(req.body?.mensaje || '').trim();

    if (mensaje.length < 5) {
      return res.status(400).json({ error: 'Contanos un poco más (mínimo 5 caracteres)' });
    }
    if (mensaje.length > 2000) {
      return res.status(400).json({ error: 'El comentario es demasiado largo (máximo 2000 caracteres)' });
    }

    // Tope simple para evitar spam: 5 comentarios por hora y por usuario
    const reciente = await pool.query(
      "SELECT COUNT(*)::int AS n FROM comentarios WHERE usuario_id = $1 AND created_at > NOW() - INTERVAL '1 hour'",
      [req.usuarioId]
    );
    if (reciente.rows[0].n >= 5) {
      return res.status(429).json({ error: 'Enviaste varios comentarios seguidos. Probá de nuevo en un rato.' });
    }

    await pool.query('INSERT INTO comentarios (usuario_id, tipo, mensaje) VALUES ($1, $2, $3)', [
      req.usuarioId,
      tipo,
      mensaje
    ]);

    // Aviso por correo al equipo. Si falla, el comentario igual queda guardado.
    try {
      if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) {
        const u = await pool.query('SELECT nombre, email FROM usuarios WHERE id = $1', [req.usuarioId]);
        const quien = u.rows[0] || {};
        await enviarCorreo({
          to: process.env.COMENTARIOS_EMAIL || process.env.BREVO_SENDER_EMAIL,
          subject: `AulaTrack · nuevo comentario (${tipo})`,
          html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
              <p><strong>${escaparHtml(quien.nombre)}</strong> (${escaparHtml(quien.email)}) dejó un comentario de tipo <strong>${escaparHtml(tipo)}</strong>:</p>
              <blockquote style="border-left: 4px solid #2563eb; margin: 12px 0; padding: 8px 14px; background: #f4f4f5;">
                ${escaparHtml(mensaje).replace(/\n/g, '<br>')}
              </blockquote>
            </div>
          `
        });
      }
    } catch (errCorreo) {
      console.error('No se pudo avisar el comentario por correo:', errCorreo.message);
    }

    res.status(201).json({ mensaje: '¡Gracias! Recibimos tu comentario.' });
  } catch (err) {
    console.error('Error al guardar comentario:', err);
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Falta la tabla de comentarios. Corré el SQL de migración de AulaTrack en Supabase.' });
    }
    res.status(500).json({ error: 'No se pudo guardar el comentario' });
  }
};

// ---------------------------------------------------------------
// CAMBIAR CONTRASEÑA (requiere token y la contraseña actual)
// ---------------------------------------------------------------
const cambiarPassword = async (req, res) => {
  try {
    const { passwordActual, passwordNueva } = req.body || {};
    if (!passwordActual || !passwordNueva) {
      return res.status(400).json({ error: 'Completá la contraseña actual y la nueva' });
    }
    if (passwordNueva.length < 6) {
      return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' });
    }

    const resultado = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const usuario = resultado.rows[0];
    const hashActual = usuario.password_hash || usuario.password;
    const coincide = hashActual ? await bcrypt.compare(passwordActual, hashActual) : false;
    if (!coincide) return res.status(400).json({ error: 'La contraseña actual no es correcta' });

    const hashNuevo = await bcrypt.hash(passwordNueva, 10);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hashNuevo, req.usuarioId]);
    res.json({ mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error al cambiar contraseña:', err);
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
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
    fin_cursada,
    carrera,
    foto
  } = req.body || {};
  const uid = req.usuarioId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mapa = new Map(); // id de invitado -> id nuevo en la BD

    // Carrera donde van las materias: la primera del usuario (si no tiene, se crea)
    const carreraExistente = await client.query('SELECT id FROM carreras WHERE usuario_id = $1 ORDER BY id LIMIT 1', [uid]);
    let carreraId;
    if (carreraExistente.rows.length) {
      carreraId = carreraExistente.rows[0].id;
    } else {
      const nuevaCarrera = await client.query('INSERT INTO carreras (usuario_id, nombre) VALUES ($1, $2) RETURNING id', [
        uid,
        (carrera && String(carrera).trim().slice(0, 120)) || 'Mi carrera'
      ]);
      carreraId = nuevaCarrera.rows[0].id;
    }

    for (const m of materias) {
      if (!m.nombre) continue;
      const r = await client.query(
        `INSERT INTO materias
           (usuario_id, nombre, anio_carrera, cuatrimestre, estado, nota_final,
            modalidad_aprobacion, clases_totales, inasistencias, asistencia_minima, carrera_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
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
          m.asistencia_minima ?? 75,
          carreraId
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

    if (fin_cursada || carrera) {
      await client.query(
        'UPDATE usuarios SET fin_cursada = COALESCE($1, fin_cursada), carrera = COALESCE($2, carrera) WHERE id = $3',
        [fin_cursada || null, carrera ? String(carrera).slice(0, 120) : null, uid]
      );
    }

    // La foto es opcional: si falla (por ejemplo, falta la columna) no se cancela la migración
    if (typeof foto === 'string' && foto.length <= 400000 && FOTO_VALIDA.test(foto)) {
      await client.query('SAVEPOINT foto_invitado');
      try {
        await client.query('UPDATE usuarios SET foto = $1 WHERE id = $2', [foto, uid]);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT foto_invitado');
      }
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
  actualizarCarrera,
  actualizarPerfil,
  enviarComentario,
  cambiarPassword,
  migrarInvitado,
  solicitarRecuperacion,
  resetearPassword
};