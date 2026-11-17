// Solicitar recuperación de contraseña
const solicitarRecuperacion = async (req, res) => {
  const { email } = req.body;
  try {
    const usuario = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuario.rows.length === 0) {
      return res.status(404).json({ error: 'No existe una cuenta con este correo' });
    }
    
    // Generar token único de reseteo (válido por 1 hora)
    const tokenReseteo = crypto.randomBytes(32).toString('hex');
    const expiracion = new Date(Date.now() + 3600000);

    await pool.query(
      'UPDATE usuarios SET token_reseteo = $1, expira_token = $2 WHERE email = $3',
      [tokenReseteo, expiracion, email]
    );

    // Aquí enviarías el email con nodemailer usando el link: 
    // https://tu-dominio.com/reset-password?token=${tokenReseteo}
    
    res.json({ mensaje: 'Correo de recuperación enviado con éxito', tokenDemo: tokenReseteo });
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

// Actualizar contraseña con el token
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
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
};