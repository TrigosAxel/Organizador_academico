const pool = require('../db');

// Obtener la configuración del usuario
const obtenerConfiguracion = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM configuracion WHERE usuario_id = $1',
      [req.usuarioId]
    );
    
    if (result.rows.length === 0) {
      // Si no existe, creamos la configuración por defecto
      const nueva = await pool.query(
        `INSERT INTO configuracion (usuario_id) VALUES ($1) RETURNING *`,
        [req.usuarioId]
      );
      return res.json(nueva.rows[0]);
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener configuración:', err);
    res.status(500).json({ error: 'Error al cargar la configuración' });
  }
};

// Actualizar configuración
const actualizarConfiguracion = async (req, res) => {
  try {
    const { tema, tamano_fuente, mostrar_estadisticas, aviso_antelacion_dias, orden_materias } = req.body;
    
    const result = await pool.query(
      `UPDATE configuracion 
       SET tema = COALESCE($1, tema),
           tamano_fuente = COALESCE($2, tamano_fuente),
           mostrar_estadisticas = COALESCE($3, mostrar_estadisticas),
           aviso_antelacion_dias = COALESCE($4, aviso_antelacion_dias),
           orden_materias = COALESCE($5, orden_materias)
       WHERE usuario_id = $6 RETURNING *`,
      [tema, tamano_fuente, mostrar_estadisticas, aviso_antelacion_dias, orden_materias, req.usuarioId]
    );
    
    if (result.rows.length === 0) {
      // Si no existe, creamos
      const nueva = await pool.query(
        `INSERT INTO configuracion (usuario_id, tema, tamano_fuente, mostrar_estadisticas, aviso_antelacion_dias, orden_materias) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.usuarioId, tema || 'light', tamano_fuente || 100, mostrar_estadisticas ?? true, aviso_antelacion_dias || 2, orden_materias || 'anio']
      );
      return res.json(nueva.rows[0]);
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar configuración:', err);
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
};

// Resetear configuración a los valores por defecto
const resetearConfiguracion = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE configuracion 
       SET tema = 'light', 
           tamano_fuente = 100, 
           mostrar_estadisticas = true, 
           aviso_antelacion_dias = 2, 
           orden_materias = 'anio'
       WHERE usuario_id = $1 RETURNING *`,
      [req.usuarioId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al resetear configuración:', err);
    res.status(500).json({ error: 'Error al resetear la configuración' });
  }
};

// Guardar comentario para los desarrolladores
const crearComentario = async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje || mensaje.trim().length === 0) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    
    const result = await pool.query(
      'INSERT INTO comentarios_dev (usuario_id, mensaje) VALUES ($1, $2) RETURNING *',
      [req.usuarioId, mensaje.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear comentario:', err);
    res.status(500).json({ error: 'Error al enviar el comentario' });
  }
};

module.exports = {
  obtenerConfiguracion,
  actualizarConfiguracion,
  resetearConfiguracion,
  crearComentario
};