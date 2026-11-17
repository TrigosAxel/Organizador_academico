const pool = require('./db');
const bcrypt = require('bcrypt');

// Registro de usuario
const registrarUsuario = async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    // Verificar si el usuario ya existe
    const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    // Encriptar la contraseña
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Guardar en la base de datos
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

    // Comparar la contraseña ingresada con el hash guardado
    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    // Generar token o devolver datos de sesión (según cómo manejes tu token JWT)
    // const token = jwt.sign({ id: usuario.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      mensaje: 'Login exitoso',
      token: 'tu_token_jwt_aqui', // Asegurate de retornar tu token real generado con JWT
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