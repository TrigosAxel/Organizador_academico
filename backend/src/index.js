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

const {
  obtenerMaterias,
  crearMateria,
  actualizarMateria,
  eliminarMateria,
  importarMaterias
} = require('./controllers/materiasController'); // (o los controladores que ya uses)

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --- Rutas de Autenticación ---
app.post('/api/auth/register', registrarUsuario);
app.post('/api/auth/login', loginUsuario);
app.get('/api/auth/me', obtenerPerfil);
app.put('/api/auth/fin-cursada', actualizarFinCursada);
app.post('/api/auth/migrar-invitado', migrarInvitado);

// Nuevos endpoints de recuperación y reseteo de contraseña
app.post('/api/auth/recuperar', solicitarRecuperacion);
app.post('/api/auth/reset-password', resetearPassword);

// Servidor corriendo
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});