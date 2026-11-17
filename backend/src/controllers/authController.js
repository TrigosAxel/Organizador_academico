const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

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
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor al registrar' });
  }
};

// Inicio de sesión
const loginUsuario = async (req, res) => {
  const { email, password } = req.body;
  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (resultado.rows.length === 0) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    const usuario = resultado.rows[0];

    const passwordValida = await bcrypt.compare(password, usuario.password);
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
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
  }
};

// Obtener perfil actual
const obtenerPerfil = async (req, res) => {
  try {
    const tokenHeader = req.headers.authorization;
    if (!tokenHeader) return res.status(401).json({ error: 'No autorizado' });
    
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

// Solicitar recuperación de contraseña
const solicitarRecuperacion = async (req, res) => {
  const { email } = req.body;
  try {
    const usuario = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuario.rows.length === 0) {
      return res.status(404).json({ error: 'No existe una cuenta con este correo' });
    }
    
    const tokenReseteo = crypto.randomBytes(32).toString('hex');
    const expiracion = new Date(Date.now() + 3600000);

    await pool.query(
      'UPDATE usuarios SET token_reseteo = $1, expira_token = $2 WHERE email = $3',
      [tokenReseteo, expiracion, email]
    );

    res.json({ mensaje: 'Correo de recuperación enviado con éxito', tokenDemo: tokenReseteo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
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
    console.error(err);
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