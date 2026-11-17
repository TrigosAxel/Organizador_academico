const express = require('express');
const cors = require('cors');
require('dotenv').config();

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

// Rutas de Autenticación y Recuperación
app.post('/api/auth/register', registrarUsuario);
app.post('/api/auth/login', loginUsuario);
app.get('/api/auth/me', obtenerPerfil);
app.put('/api/auth/fin-cursada', actualizarFinCursada);
app.post('/api/auth/migrar-invitado', migrarInvitado);
app.post('/api/auth/recuperar', solicitarRecuperacion);
app.post('/api/auth/reset-password', resetearPassword);
// --- RUTAS DE LA APLICACIÓN ACADÉMICA ---

// Si usas tu conexión a base de datos (db) para responder directamente:
const db = require('./db');

app.get('/api/materias', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM materias'); // o la consulta que uses
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/materias', async (req, res) => {
  try {
    // Lógica para insertar materia
    res.json({ success: true, message: "Materia creada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... tus rutas de auth ...
// ... tus rutas de materias ...

// --- HORARIOS ---
app.get('/api/horarios', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM horarios');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/horarios', async (req, res) => {
  try {
    const { materia_id, dia, hora_inicio, hora_fin, aula } = req.body;
    const result = await db.query(
      'INSERT INTO horarios (materia_id, dia, hora_inicio, hora_fin, aula) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [materia_id, dia, hora_inicio, hora_fin, aula]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- EXÁMENES ---
app.get('/api/examenes', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM examenes');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CORRELATIVAS ---
app.get('/api/correlativas', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM correlativas');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TPS ---
app.get('/api/tps', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tps');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});