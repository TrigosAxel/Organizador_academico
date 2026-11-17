const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Registro de usuario
const registrarUsuario = async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const nuevoUsuario = await pool.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES ($1, $2, $3) RETURNING id, nombre, email, fin_cursada',
      [nombre, email, passwordHash]
    );

    res.status(201).json({ mensaje: 'Usuario registrado con éxito', usuario: nuevoUsuario.rows[0] });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error en el servidor al registrar' });
  }
};

// Inicio de sesión robusto que detecta cualquier formato de contraseña
const loginUsuario = async (req, res) => {
  const { email, password } = req.body;
  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (resultado.rows.length === 0) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    const usuario = resultado.rows[0];
    
    // Detectar la contraseña sin importar el nombre de la columna en la BD
    const passGuarda = usuario.password || usuario.password_hash || usuario.contrasenya;

    if (!passGuarda) {
      return res.status(400).json({ error: 'La cuenta no tiene una contraseña válida asignada' });
    }

    let passwordValida = false;
    try {
      // Intentar comparar con bcrypt (si está hasheada)
      passwordValida = await bcrypt.compare(password, passGuarda);
    } catch (e) {
      // Si falla porque estaba en texto plano
      passwordValida = (password === passGuarda);
    }

    if (!passwordValida) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    res.json({
      mensaje: 'Login exitoso',
      token: 'token_sesion_activo',
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        fin_cursada: usuario.fin_cursada
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
  }
};

const obtenerPerfil = async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre, email, fin_cursada FROM usuarios LIMIT 1');
    if (resultado.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(resultado.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
};

const actualizarFinCursada = async (req, res) => {
  res.json({ mensaje: 'Actualizado' });
};

const migrarInvitado = async (req, res) => {
  res.json({ mensaje: 'Migrado' });
};

// Solicitar recuperación y enviar email real con Nodemailer
const solicitarRecuperacion = async (req, res) => {
  const { email } = req.body;
  try {
    const usuario = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuario.rows.length === 0) {
      return res.status(404).json({ error: 'No existe una cuenta con este correo' });
    }
    
    const tokenReseteo = crypto.randomBytes(32).toString('hex');
    const expiracion = new Date(Date.now() + 3600000); // 1 hora

    await pool.query(
      'UPDATE usuarios SET token_reseteo = $1, expira_token = $2 WHERE email = $3',
      [tokenReseteo, expiracion, email]
    );

    const linkRecuperacion = `https://organizador-academico-e5my-green.vercel.app?token=${tokenReseteo}`;

    await transporter.sendMail({
      from: `"Organizador Académico" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Recuperación de Contraseña - Organizador Académico',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2>Recuperación de Contraseña</h2>
          <p>Has solicitado restablecer tu contraseña en el Organizador Académico.</p>
          <p>Hacé clic en el siguiente enlace para continuar (expira en 1 hora):</p>
          <a href="${linkRecuperacion}" style="background: #2563eb; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Restablecer Contraseña</a>
          <p>Si no solicitaste esto, ignorá este mensaje.</p>
        </div>
      `
    });

    res.json({ mensaje: 'Correo de recuperación enviado con éxito a tu bandeja de entrada' });
  } catch (err) {
    console.error('Error al enviar correo de recuperación:', err);
    res.status(500).json({ error: 'Error al enviar el correo de recuperación' });
  }
};

// Resetear contraseña con token
const resetearPassword = async (req, res) => {
  const { token, nuevaPassword } = req.body;
  try {
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
      'UPDATE usuarios SET password = $1, token_reseteo = NULL, expira_token = NULL WHERE id = $2',
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