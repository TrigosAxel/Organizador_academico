'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

interface Usuario {
  id: number;
  nombre: string;
  email: string;
  fin_cursada: string | null;
  carrera?: string | null;
  foto?: string | null;
}

interface Materia {
  id: number;
  nombre: string;
  año?: number;
  anio?: number;
  cuatrimestre: number | string;
  estado: string;
  clases_totales: number;
  anio_carrera?: number;
  inasistencias: number;
  modalidad_aprobacion?: string | null;
  nota_final?: number | null;
  asistencia_minima?: number;
}
interface Horario {
  id?: number;
  materia_id: number;
  materia_nombre: string;
  dia?: string;
  dia_semana?: string;
  hora_inicio: string;
  hora_fin: string;
  aula: string | null;
}
interface Correlativa {
  id?: number;
  materia_id: number;
  correlativa_id: number;
  correlativa_estado?: string;
  tipo_requisito?: string;
  correlativa_nombre?: string;
  materia_nombre?: string;
}
interface Examen {
  id?: number;
  materia_id?: number;
  materia_nombre: string;
  titulo: string;
  fecha: string;
  nota_intento_1: number | null;
  nota_intento_2: number | null;
  nota_vigente: number | null;
  intentos?: (number | null)[];
  condicion: 'pendiente' | 'aprobado' | 'desaprobado' | 'promociona';
  notas_estudio: string | null;
}

interface TrabajoPractico {
  id: number;
  materia_id: number;
  materia_nombre: string;
  titulo: string;
  fecha_entrega: string;
  estado: 'pendiente' | 'entregado' | 'aprobado' | 'rehacer';
  nota: number | null;
  descripcion?: string | null;
}

const BASE_API = 'https://organizador-academico-6kv1.onrender.com/api';

const aNumero = (v: unknown): number | null =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

// Lista de notas de un examen, sin límite de intentos.
// Si el examen es viejo (solo nota_intento_1 / nota_intento_2) arma la lista a partir de esos campos.
const intentosDe = (ex: Examen): (number | null)[] => {
  if (Array.isArray(ex.intentos) && ex.intentos.length > 0) return ex.intentos.map(aNumero);
  const viejos = [aNumero(ex.nota_intento_1), aNumero(ex.nota_intento_2)];
  while (viejos.length > 0 && viejos[viejos.length - 1] === null) viejos.pop();
  return viejos;
};

const mejorNota = (intentos: (number | null)[]): number | null => {
  const validos = intentos.filter((n): n is number => n !== null);
  return validos.length > 0 ? Math.max(...validos) : null;
};

const iniciales = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

// Recorta la foto en cuadrado y la reduce a 256x256 (JPEG) para que pese poco
const procesarFoto = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
      img.onload = () => {
        const lado = Math.min(img.width, img.height);
        const sx = (img.width - lado) / 2;
        const sy = (img.height - lado) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo procesar la imagen'));
          return;
        }
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, 256, 256);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_CURSADA: Horario['dia_semana'][] = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
];

const PLAN_EJEMPLO_SISTEMAS = [
  { nombre: 'Fundamentos de Programación', anio_carrera: 1, cuatrimestre: '1ro' },
  { nombre: 'Matemática Discreta', anio_carrera: 1, cuatrimestre: '1ro' },
  { nombre: 'Arquitectura de Computadoras', anio_carrera: 1, cuatrimestre: '1ro' },
  { nombre: 'Programación Orientada a Objetos', anio_carrera: 1, cuatrimestre: '2do' },
  { nombre: 'Álgebra Lineal', anio_carrera: 1, cuatrimestre: '2do' },
  { nombre: 'Sistemas y Organizaciones', anio_carrera: 1, cuatrimestre: '2do' },
  { nombre: 'Base de Datos', anio_carrera: 2, cuatrimestre: '1ro' },
  { nombre: 'Sistemas Operativos', anio_carrera: 2, cuatrimestre: '1ro' },
  { nombre: 'Probabilidad y Estadística', anio_carrera: 2, cuatrimestre: '1ro' },
  { nombre: 'Ingeniería de Software I', anio_carrera: 2, cuatrimestre: '2do' },
  { nombre: 'Lenguajes Formales y Autómatas', anio_carrera: 2, cuatrimestre: '2do' },
  { nombre: 'Paradigmas y Lenguajes', anio_carrera: 3, cuatrimestre: '1ro' },
  { nombre: 'Sistemas Distribuidos', anio_carrera: 3, cuatrimestre: '2do' },
];

export default function Home() {
  const [modoSesion, setModoSesion] = useState<'auth' | 'guest' | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [modoAuth, setModoAuth] = useState<'login' | 'register'>('login');
  const [authNombre, setAuthNombre] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [verificandoSesion, setVerificandoSesion] = useState(true);

  // Recuperación de contraseña (pantallas propias)
  // Si llega desde el link del mail (?token=...), arranca directo en la pantalla de nueva contraseña
  const [vistaRecuperar, setVistaRecuperar] = useState<'olvide' | 'reset' | null>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('token')
      ? 'reset'
      : null
  );
  const [recuEmail, setRecuEmail] = useState('');
  const [recuPass, setRecuPass] = useState('');
  const [recuPass2, setRecuPass2] = useState('');
  const [resetToken, setResetToken] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('token') || ''
  );
  const [recuError, setRecuError] = useState('');
  const [recuMensaje, setRecuMensaje] = useState('');
  const [recuCargando, setRecuCargando] = useState(false);

  // Edición de materia, reseteo de materias y carrera
  const [materiaEditando, setMateriaEditando] = useState<Materia | null>(null);
  const [formEdit, setFormEdit] = useState({
    nombre: '',
    anio_carrera: '1',
    cuatrimestre: '1ro',
    estado: 'pendiente',
    nota_final: '',
    modalidad_aprobacion: 'promocionada',
    asistencia_minima: '75',
    clases_totales: '0',
    inasistencias: '0',
  });
  const [errorEdit, setErrorEdit] = useState('');
  const [mostrarReset, setMostrarReset] = useState(false);
  const [textoReset, setTextoReset] = useState('');
  const [errorReset, setErrorReset] = useState('');
  const [reseteando, setReseteando] = useState(false);
  // Panel de usuario
  const [panelUsuarioAbierto, setPanelUsuarioAbierto] = useState(false);
  const [perfilNombre, setPerfilNombre] = useState('');
  const [perfilCarrera, setPerfilCarrera] = useState('');
  const [perfilMsg, setPerfilMsg] = useState('');
  const [perfilError, setPerfilError] = useState('');
  const [perfilGuardando, setPerfilGuardando] = useState(false);
  const [mostrarCambioPass, setMostrarCambioPass] = useState(false);
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passNueva2, setPassNueva2] = useState('');
  const [passMsg, setPassMsg] = useState('');
  const [passError, setPassError] = useState('');
  const [passGuardando, setPassGuardando] = useState(false);
  const [materiaPorBorrar, setMateriaPorBorrar] = useState<Materia | null>(null);
  const [autenticando, setAutenticando] = useState(false);

  const [mostrarModalMigracion, setMostrarModalMigracion] = useState(false);
  const [migrando, setMigrando] = useState(false);

  const [tab, setTab] = useState<
    'materias' | 'horarios' | 'examenes' | 'tps' | 'calendario' | 'correlativas'
  >('materias');

  const [materias, setMaterias] = useState<Materia[]>([]);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [correlativas, setCorrelativas] = useState<Correlativa[]>([]);
  const [examenes, setExamenes] = useState<Examen[]>([]);
  const [tps, setTps] = useState<TrabajoPractico[]>([]);

  const [busqueda, setBusqueda] = useState('');
  const [filtroAnio, setFiltroAnio] = useState<string>('todos');
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');

  const [mostrarImportador, setMostrarImportador] = useState(false);
  const [textoImportar, setTextoImportar] = useState('');

  const [editandoFin, setEditandoFin] = useState(false);
  const [inputFinCursada, setInputFinCursada] = useState('');
  
  const [ahora, setAhora] = useState<number>(0);
  const [mesActual, setMesActual] = useState({ anio: 2026, mes: 10 });
  
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [tipoAgendarRapido, setTipoAgendarRapido] = useState<'examen' | 'tp'>('examen');

  const [nombre, setNombre] = useState('');
  const [anioCarrera, setAnioCarrera] = useState(1);
  const [cuatrimestre, setCuatrimestre] = useState('1ro');
  const [estado, setEstado] = useState<Materia['estado']>('cursando');
  const [notaFinal, setNotaFinal] = useState('');
  const [modalidadAprobacion, setModalidadAprobacion] = useState<'promocionada' | 'final'>('promocionada');
  const [asistenciaMinima, setAsistenciaMinima] = useState(75);

  const [horMateriaId, setHorMateriaId] = useState('');
  const [horDia, setHorDia] = useState<Horario['dia_semana']>('Lunes');
  const [horInicio, setHorInicio] = useState('18:00');
  const [horFin, setHorFin] = useState('21:00');
  const [horAula, setHorAula] = useState('');

  const [examMateriaId, setExamMateriaId] = useState('');
  const [examTitulo, setExamTitulo] = useState('');
  const [examFecha, setExamFecha] = useState('');
  const [examNotas, setExamNotas] = useState('');

  const [tpMateriaId, setTpMateriaId] = useState('');
  const [tpTitulo, setTpTitulo] = useState('');
  const [tpFecha, setTpFecha] = useState('');
  const [tpDescripcion, setTpDescripcion] = useState('');

  const [corrMateriaId, setCorrMateriaId] = useState('');
  const [corrRequisitoIds, setCorrRequisitoIds] = useState<string[]>([]);
  const [errorCorr, setErrorCorr] = useState('');
  const [corrTipo, setCorrTipo] = useState<'regular' | 'aprobada'>('regular');

  const guardarGuestLocal = (datos: {
    usuario?: Usuario;
    materias?: Materia[];
    horarios?: Horario[];
    correlativas?: Correlativa[];
    examenes?: Examen[];
    tps?: TrabajoPractico[];
  }) => {
    const actual = JSON.parse(localStorage.getItem('organizador_guest_data') || '{}');
    const actualizado = { ...actual, ...datos };
    localStorage.setItem('organizador_guest_data', JSON.stringify(actualizado));
  };

  const cargarDatosAuth = useCallback(async (authToken: string) => {
    const headers = { Authorization: `Bearer ${authToken}` };
    const [resMe, resMat, resHor, resCorr, resExam, resTps] = await Promise.all([
      fetch(`${BASE_API}/auth/me`, { headers }),
      fetch(`${BASE_API}/materias`, { headers }),
      fetch(`${BASE_API}/horarios`, { headers }),
      fetch(`${BASE_API}/correlativas`, { headers }),
      fetch(`${BASE_API}/examenes`, { headers }),
      fetch(`${BASE_API}/tps`, { headers }),
    ]);

    if (!resMe.ok) {
      localStorage.removeItem('organizador_token');
      setToken(null);
      setUsuario(null);
      setModoSesion(null);
      return;
    }

    const [dataMe, dataMat, dataHor, dataCorr, dataExam, dataTps] = await Promise.all([
      resMe.json(),
      resMat.json(),
      resHor.json(),
      resCorr.json(),
      resExam.json(),
      resTps.json(),
    ]);

    setUsuario(dataMe);
    if (Array.isArray(dataMat)) setMaterias(dataMat);
    if (Array.isArray(dataHor)) setHorarios(dataHor);
    if (Array.isArray(dataCorr)) setCorrelativas(dataCorr);
    if (Array.isArray(dataExam)) setExamenes(dataExam);
    if (Array.isArray(dataTps)) setTps(dataTps);
  }, []);

  useEffect(() => {
    let activo = true;

    const intervalo = setInterval(() => setAhora(Date.now()), 1000);

    const inicializar = async () => {
      const guardadoToken = localStorage.getItem('organizador_token');
      const modoGuardado = localStorage.getItem('organizador_modo');

      if (guardadoToken) {
        try {
          await cargarDatosAuth(guardadoToken);
          if (activo) {
            setToken(guardadoToken);
            setModoSesion('auth');
          }
        } catch (err) {
          console.error(err);
        } finally {
          if (activo) setVerificandoSesion(false);
        }
        return;
      }

      if (modoGuardado === 'guest') {
        const guestRaw = JSON.parse(localStorage.getItem('organizador_guest_data') || '{}');
        if (activo) {
          setModoSesion('guest');
          setUsuario(
            guestRaw.usuario || {
              id: 0,
              nombre: 'Invitado',
              email: 'Modo local sin cuenta',
              fin_cursada: null,
            }
          );
          setMaterias(guestRaw.materias || []);
          setHorarios(guestRaw.horarios || []);
          setCorrelativas(guestRaw.correlativas || []);
          setExamenes(guestRaw.examenes || []);
          setTps(guestRaw.tps || []);
          setVerificandoSesion(false);
        }
        return;
      }

      if (activo) setVerificandoSesion(false);
    };

    inicializar();
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [cargarDatosAuth]);

  const entrarComoInvitado = () => {
    localStorage.setItem('organizador_modo', 'guest');
    const guestRaw = JSON.parse(localStorage.getItem('organizador_guest_data') || '{}');
    const userInvitado: Usuario = guestRaw.usuario || {
      id: 0,
      nombre: 'Invitado',
      email: 'Guardado local en este navegador',
      fin_cursada: null,
    };
    setModoSesion('guest');
    setUsuario(userInvitado);
    setMaterias(guestRaw.materias || []);
    setHorarios(guestRaw.horarios || []);
    setCorrelativas(guestRaw.correlativas || []);
    setExamenes(guestRaw.examenes || []);
    setTps(guestRaw.tps || []);
    guardarGuestLocal({ usuario: userInvitado });
  };

  const manejarAuth = async (e: React.FormEvent, migrarDatosLocales = false) => {
    e.preventDefault();
    setAuthError('');
    setAutenticando(true);
    const endpoint = modoAuth === 'login' ? '/auth/login' : '/auth/register';
    const body =
      modoAuth === 'login'
        ? { email: authEmail, password: authPassword }
        : { nombre: authNombre, email: authEmail, password: authPassword };

    try {
      if (migrarDatosLocales) setMigrando(true);
      const res = await fetch(`${BASE_API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Error de autenticación');
        setMigrando(false);
        return;
      }

      if (migrarDatosLocales) {
        await fetch(`${BASE_API}/auth/migrar-invitado`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.token}`,
          },
          body: JSON.stringify({
            materias,
            horarios,
            examenes,
            tps,
            correlativas,
            fin_cursada: usuario?.fin_cursada || null,
            carrera: usuario?.carrera || null,
          }),
        });
        localStorage.removeItem('organizador_guest_data');
      }

      localStorage.removeItem('organizador_modo');
      localStorage.setItem('organizador_token', data.token);
      setToken(data.token);
      setModoSesion('auth');
      setUsuario(data.usuario);
      setMostrarModalMigracion(false);
      await cargarDatosAuth(data.token);
    } catch {
      setAuthError('No se pudo conectar con el servidor');
    } finally {
      setMigrando(false);
      setAutenticando(false);
    }
  };

  const salir = () => {
    localStorage.removeItem('organizador_token');
    localStorage.removeItem('organizador_modo');
    setToken(null);
    setModoSesion(null);
    setUsuario(null);
    setMaterias([]);
    setHorarios([]);
    setExamenes([]);
    setTps([]);
    setCorrelativas([]);
  };

  const exportarCSV = () => {
    const encabezados = ['Año', 'Cuatrimestre', 'Materia', 'Estado', 'Modalidad', 'Nota Final', 'Asistencia (%)'];
    const filas = materias.map((m) => {
      const presentes = Math.max(0, m.clases_totales - m.inasistencias);
      const pct = m.clases_totales > 0 ? Math.round((presentes / m.clases_totales) * 100) : 100;
      return [
        `${m.anio_carrera}°`,
        m.cuatrimestre,
        `"${m.nombre.replace(/"/g, '""')}"`,
        m.estado.toUpperCase(),
        m.modalidad_aprobacion ? m.modalidad_aprobacion.toUpperCase() : '-',
        m.nota_final !== null ? m.nota_final : '-',
        `${pct}%`,
      ].join(',');
    });

    const csvContenido = '\uFEFF' + [encabezados.join(','), ...filas].join('\n');
    const blob = new Blob([csvContenido], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `avance_academico_${usuario?.nombre || 'estudiante'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportarReportePDF = () => {
    const ventana = window.open('', '_blank', 'width=900,height=700');
    if (!ventana) return;

    const filasHtml = materias
      .map(
        (m) => `
        <tr>
          <td>${m.anio_carrera}° Año</td>
          <td>${m.cuatrimestre}</td>
          <td><strong>${m.nombre}</strong></td>
          <td>${m.estado.toUpperCase()}</td>
          <td>${m.modalidad_aprobacion || '-'}</td>
          <td>${m.nota_final !== null ? m.nota_final : '-'}</td>
        </tr>`
      )
      .join('');

    ventana.document.write(`
      <html>
        <head>
          <title>Avance Académico - ${usuario?.nombre}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
            h1 { margin-bottom: 4px; }
            .resumen { display: flex; gap: 24px; margin: 20px 0; padding: 14px; background: #f4f4f5; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
            th, td { border: 1px solid #d4d4d8; padding: 8px 10px; text-align: left; }
            th { background: #27272a; color: white; }
          </style>
        </head>
        <body>
          <h1>Resumen de Avance Académico</h1>
          <p>Estudiante: <strong>${usuario?.nombre}</strong>${usuario?.carrera ? ` · Carrera: <strong>${usuario.carrera}</strong>` : ''} · Fecha: ${new Date().toLocaleDateString()}</p>
          <div class="resumen">
            <div><strong>Materias Aprobadas:</strong> ${aprobadas.length} / ${materias.length} (${porcentajeCarrera}%)</div>
            <div><strong>Promedio General:</strong> ${promedio}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Año</th>
                <th>Régimen</th>
                <th>Materia</th>
                <th>Estado</th>
                <th>Modalidad</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>${filasHtml}</tbody>
          </table>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    ventana.document.close();
  };

  const guardarFinCursada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputFinCursada || !usuario) return;
    const isoDate = new Date(inputFinCursada).toISOString();

    if (modoSesion === 'guest') {
      const nuevoU = { ...usuario, fin_cursada: isoDate };
      setUsuario(nuevoU);
      guardarGuestLocal({ usuario: nuevoU });
      setEditandoFin(false);
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/auth/fin-cursada`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fin_cursada: isoDate }),
    });
    setEditandoFin(false);
    cargarDatosAuth(token);
  };

 const agregarMateria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/materias`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // 👈 Clave para que el backend reconozca tu usuario
        },
        body: JSON.stringify({
          nombre: nombre.trim(),
          anio_carrera: parseInt(String(anioCarrera)) || 1,
         cuatrimestre: cuatrimestre, // o cuatrimestre === 'anual' ? 'Anual' : cuatrimestre
          estado: estado ? estado.toLowerCase() : 'pendiente',
          nota_final: estado === 'aprobada' && notaFinal ? Number(notaFinal) : null,
          modalidad_aprobacion: estado === 'aprobada' ? modalidadAprobacion.toLowerCase() : null,
          asistencia_minima: Number(asistenciaMinima) || 75,
        }),
      });

      if (response.ok) {
        const nuevaMateriaBD = await response.json();
        setMaterias([...materias, nuevaMateriaBD]);
        setNombre('');
        if (typeof cargarDatosAuth === 'function' && token) {
          cargarDatosAuth(token);
        }
      } else {
        const errorData = await response.json();
        console.error('Error al guardar en el servidor:', errorData);
        alert('Error: ' + (errorData.error || 'No se pudo guardar'));
      }
    } catch (error) {
      console.error('Error de red al agregar materia:', error);
    }
  };

  const actualizarMateria = async (actualizada: Materia) => {
    if (modoSesion === 'guest') {
      const nuevas = materias.map((m) => (m.id === actualizada.id ? actualizada : m));
      setMaterias(nuevas);
      guardarGuestLocal({ materias: nuevas });
      return;
    }
    if (!token) return;
    await fetch(`${BASE_API}/materias/${actualizada.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(actualizada),
    });
    cargarDatosAuth(token);
  };

  const cambiarEstado = async (materia: Materia, nuevoEstado: Materia['estado']) => {
    let nuevaNota = materia.nota_final;
    let nuevaModalidad = materia.modalidad_aprobacion;

    if (nuevoEstado === 'aprobada') {
      if (!nuevaNota) {
        const inputNota = prompt(`Ingresá la nota final de ${materia.nombre} (1 a 10):`);
        if (inputNota) nuevaNota = Number(inputNota);
      }
      if (!nuevaModalidad) {
        const esPromo = confirm(
          `¿Aprobaste "${materia.nombre}" por PROMOCIÓN?\n\n• Aceptar = Promocionada\n• Cancelar = Por Examen Final`
        );
        nuevaModalidad = esPromo ? 'promocionada' : 'final';
      }
    } else {
      nuevaNota = null;
      nuevaModalidad = null;
    }

    await actualizarMateria({
      ...materia,
      estado: nuevoEstado,
      nota_final: nuevaNota,
      modalidad_aprobacion: nuevaModalidad,
    });
  };

  const eliminarMateria = async (id: number) => {
    if (modoSesion === 'guest') {
      const nuevas = materias.filter((m) => m.id !== id);
      const nuevosHor = horarios.filter((h) => h.materia_id !== id);
      const nuevosEx = examenes.filter((e) => e.materia_id !== id);
      const nuevosTp = tps.filter((t) => t.materia_id !== id);
      const nuevasCorr = correlativas.filter((c) => c.materia_id !== id && c.correlativa_id !== id);
      setMaterias(nuevas);
      setHorarios(nuevosHor);
      setExamenes(nuevosEx);
      setTps(nuevosTp);
      setCorrelativas(nuevasCorr);
      guardarGuestLocal({
        materias: nuevas,
        horarios: nuevosHor,
        examenes: nuevosEx,
        tps: nuevosTp,
        correlativas: nuevasCorr,
      });
      return;
    }
    if (!token) return;
    await fetch(`${BASE_API}/materias/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    cargarDatosAuth(token);
  };

  const abrirEdicion = (m: Materia) => {
    setErrorEdit('');
    setMateriaEditando(m);
    setFormEdit({
      nombre: m.nombre,
      anio_carrera: String(m.anio_carrera ?? m.anio ?? 1),
      cuatrimestre: String(m.cuatrimestre),
      estado: m.estado,
      nota_final: m.nota_final !== null && m.nota_final !== undefined ? String(m.nota_final) : '',
      modalidad_aprobacion: m.modalidad_aprobacion || 'promocionada',
      asistencia_minima: String(m.asistencia_minima ?? 75),
      clases_totales: String(m.clases_totales ?? 0),
      inasistencias: String(m.inasistencias ?? 0),
    });
  };

  const setCampoEdit = (campo: keyof typeof formEdit, valor: string) =>
    setFormEdit((prev) => ({ ...prev, [campo]: valor }));

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!materiaEditando) return;

    const nombreLimpio = formEdit.nombre.trim();
    const anio = Number(formEdit.anio_carrera);
    const asistMin = Number(formEdit.asistencia_minima);
    const clases = Number(formEdit.clases_totales);
    const faltas = Number(formEdit.inasistencias);
    const aprobada = formEdit.estado === 'aprobada';
    const nota = formEdit.nota_final === '' ? null : Number(formEdit.nota_final);

    if (!nombreLimpio) return setErrorEdit('El nombre no puede estar vacío');
    if (!Number.isInteger(anio) || anio < 1 || anio > 6) return setErrorEdit('El año debe ser de 1 a 6');
    if (Number.isNaN(asistMin) || asistMin < 0 || asistMin > 100)
      return setErrorEdit('La asistencia mínima debe estar entre 0 y 100');
    if (!Number.isInteger(clases) || clases < 0) return setErrorEdit('Las clases totales no pueden ser negativas');
    if (!Number.isInteger(faltas) || faltas < 0 || faltas > clases)
      return setErrorEdit('Las inasistencias no pueden superar las clases totales');
    if (aprobada && nota !== null && (Number.isNaN(nota) || nota < 1 || nota > 10))
      return setErrorEdit('La nota debe estar entre 1 y 10');

    await actualizarMateria({
      ...materiaEditando,
      nombre: nombreLimpio,
      anio_carrera: anio,
      cuatrimestre: formEdit.cuatrimestre,
      estado: formEdit.estado as Materia['estado'],
      nota_final: aprobada ? nota : null,
      modalidad_aprobacion: aprobada ? formEdit.modalidad_aprobacion : null,
      asistencia_minima: asistMin,
      clases_totales: clases,
      inasistencias: faltas,
    });
    setMateriaEditando(null);
  };

  const resetearMaterias = async () => {
    setErrorReset('');
    setReseteando(true);
    try {
      if (modoSesion === 'guest') {
        setMaterias([]);
        setHorarios([]);
        setExamenes([]);
        setTps([]);
        setCorrelativas([]);
        guardarGuestLocal({ materias: [], horarios: [], examenes: [], tps: [], correlativas: [] });
      } else {
        if (!token) return;
        const res = await fetch(`${BASE_API}/materias`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setErrorReset(data.error || 'No se pudieron borrar las materias');
          return;
        }
        await cargarDatosAuth(token);
      }
      setMostrarReset(false);
      setTextoReset('');
    } catch {
      setErrorReset('No se pudo conectar con el servidor');
    } finally {
      setReseteando(false);
    }
  };

  const alternarPanelUsuario = () => {
    if (!panelUsuarioAbierto && usuario) {
      setPerfilNombre(usuario.nombre);
      setPerfilCarrera(usuario.carrera || '');
      setPerfilMsg('');
      setPerfilError('');
      setMostrarCambioPass(false);
    }
    setPanelUsuarioAbierto(!panelUsuarioAbierto);
  };

  // Guarda cambios del perfil (nombre, carrera y/o foto)
  const guardarPerfil = async (cambios: {
    nombre?: string;
    carrera?: string | null;
    foto?: string | null;
  }) => {
    if (!usuario) return;
    setPerfilError('');
    setPerfilMsg('');
    setPerfilGuardando(true);
    try {
      if (modoSesion === 'guest') {
        const nuevoU = { ...usuario, ...cambios };
        setUsuario(nuevoU);
        guardarGuestLocal({ usuario: nuevoU });
        setPerfilMsg('Cambios guardados');
        return;
      }
      if (!token) return;
      const res = await fetch(`${BASE_API}/auth/perfil`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cambios),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPerfilError(data.error || 'No se pudieron guardar los cambios');
        return;
      }
      setUsuario(data.usuario);
      setPerfilMsg('Cambios guardados');
    } catch {
      setPerfilError('No se pudo conectar con el servidor');
    } finally {
      setPerfilGuardando(false);
    }
  };

  const guardarDatosPerfil = (e: React.FormEvent) => {
    e.preventDefault();
    const nombre = perfilNombre.trim();
    if (!nombre) {
      setPerfilError('El nombre no puede estar vacío');
      return;
    }
    guardarPerfil({ nombre, carrera: perfilCarrera.trim() || null });
  };

  const cambiarFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setPerfilError('');
    setPerfilMsg('');
    if (!archivo.type.startsWith('image/')) {
      setPerfilError('Elegí un archivo de imagen');
      return;
    }
    if (archivo.size > 10 * 1024 * 1024) {
      setPerfilError('La imagen es muy pesada (máximo 10 MB)');
      return;
    }
    try {
      const foto = await procesarFoto(archivo);
      await guardarPerfil({ foto });
    } catch (err) {
      setPerfilError(err instanceof Error ? err.message : 'No se pudo cargar la foto');
    }
  };

  const cambiarPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassMsg('');
    if (passNueva.length < 6) {
      setPassError('La contraseña nueva debe tener al menos 6 caracteres');
      return;
    }
    if (passNueva !== passNueva2) {
      setPassError('Las contraseñas nuevas no coinciden');
      return;
    }
    if (!token) return;
    setPassGuardando(true);
    try {
      const res = await fetch(`${BASE_API}/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ passwordActual: passActual, passwordNueva: passNueva }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPassError(data.error || 'No se pudo cambiar la contraseña');
        return;
      }
      setPassMsg(data.mensaje || 'Contraseña actualizada');
      setPassActual('');
      setPassNueva('');
      setPassNueva2('');
    } catch {
      setPassError('No se pudo conectar con el servidor');
    } finally {
      setPassGuardando(false);
    }
  };

  const importarPlan = async (items: { nombre: string; anio_carrera: number; cuatrimestre: string }[]) => {
    if (items.length === 0) return;

    if (modoSesion === 'guest') {
      const creadas: Materia[] = items.map((it, i) => ({
        id: Date.now() + i,
        nombre: it.nombre,
        anio_carrera: it.anio_carrera,
        cuatrimestre: it.cuatrimestre,
        estado: 'pendiente',
        nota_final: null,
        modalidad_aprobacion: null,
        clases_totales: 0,
        inasistencias: 0,
        asistencia_minima: 75,
      }));
      const nuevas = [...materias, ...creadas];
      setMaterias(nuevas);
      guardarGuestLocal({ materias: nuevas });
      setMostrarImportador(false);
      setTextoImportar('');
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/materias/importar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lista: items }),
    });
    setMostrarImportador(false);
    setTextoImportar('');
    cargarDatosAuth(token);
  };

  const procesarTextoImportacion = (e: React.FormEvent) => {
    e.preventDefault();
    const lineas = textoImportar
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const lista = lineas.map((linea) => {
      const partes = linea.split('|').map((p) => p.trim());
      return {
        nombre: partes[0],
        anio_carrera: Number(partes[1]) || 1,
        cuatrimestre: ['1ro', '2do', 'Anual'].includes(partes[2]) ? partes[2] : '1ro',
      };
    });
    importarPlan(lista);
  };

  const agregarHorario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!horMateriaId || !horInicio || !horFin) return;
    const matObj = materias.find((m) => m.id === Number(horMateriaId));
    if (!matObj) return;

    if (modoSesion === 'guest') {
      const nuevoH: Horario = {
        id: Date.now(),
        materia_id: matObj.id,
        materia_nombre: matObj.nombre,
        dia_semana: horDia,
        hora_inicio: horInicio,
        hora_fin: horFin,
        aula: horAula.trim() || null,
      };
      const nuevos = [...horarios, nuevoH];
      setHorarios(nuevos);
      guardarGuestLocal({ horarios: nuevos });
      setHorAula('');
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/horarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        materia_id: Number(horMateriaId),
        dia_semana: horDia,
        hora_inicio: horInicio,
        hora_fin: horFin,
        aula: horAula.trim() || null,
      }),
    });
    setHorAula('');
    cargarDatosAuth(token);
  };

  const eliminarHorario = async (id: number) => {
    if (modoSesion === 'guest') {
      const nuevos = horarios.filter((h) => h.id !== id);
      setHorarios(nuevos);
      guardarGuestLocal({ horarios: nuevos });
      return;
    }
    if (!token) return;
    await fetch(`${BASE_API}/horarios/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    cargarDatosAuth(token);
  };

  const agregarExamen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examMateriaId || !examTitulo.trim() || !examFecha) return;
    const matObj = materias.find((m) => m.id === Number(examMateriaId));
    if (!matObj) return;

    if (modoSesion === 'guest') {
      const nuevoEx: Examen = {
        id: Date.now(),
        materia_id: matObj.id,
        materia_nombre: matObj.nombre,
        titulo: examTitulo,
        fecha: examFecha,
        nota_intento_1: null,
        nota_intento_2: null,
        nota_vigente: null,
        intentos: [],
        condicion: 'pendiente',
        notas_estudio: examNotas || null,
      };
      const nuevos = [...examenes, nuevoEx];
      setExamenes(nuevos);
      guardarGuestLocal({ examenes: nuevos });
      setExamTitulo('');
      setExamFecha('');
      setExamNotas('');
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/examenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        materia_id: Number(examMateriaId),
        titulo: examTitulo,
        fecha: examFecha,
        notas_estudio: examNotas,
      }),
    });
    setExamTitulo('');
    setExamFecha('');
    setExamNotas('');
    cargarDatosAuth(token);
  };

  // Guarda la lista de intentos (y la condición) de un examen
  const guardarExamen = async (
    examen: Examen,
    intentos: (number | null)[],
    condicionManual?: Examen['condicion']
  ) => {
    const vigente = mejorNota(intentos);

    let condicion = condicionManual ?? examen.condicion;
    if (!condicionManual && condicion !== 'promociona') {
      condicion = vigente === null ? 'pendiente' : vigente >= 6 ? 'aprobado' : 'desaprobado';
    }

    if (modoSesion === 'guest') {
      const nuevos = examenes.map((ex) =>
        ex.id === examen.id
          ? {
              ...ex,
              intentos,
              nota_intento_1: intentos[0] ?? null,
              nota_intento_2: intentos[1] ?? null,
              nota_vigente: vigente,
              condicion,
            }
          : ex
      );
      setExamenes(nuevos);
      guardarGuestLocal({ examenes: nuevos });
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/examenes/${examen.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ intentos, condicion }),
    });
    cargarDatosAuth(token);
  };

  const cambiarIntento = async (examen: Examen, indice: number, valor: string) => {
    const actuales = intentosDe(examen);
    let nuevo = aNumero(valor);
    if (nuevo !== null) nuevo = Math.min(10, Math.max(0, nuevo));
    if ((actuales[indice] ?? null) === nuevo) return;
    const lista = [...actuales];
    lista[indice] = nuevo;
    await guardarExamen(examen, lista);
  };

  const agregarIntento = (examen: Examen) => guardarExamen(examen, [...intentosDe(examen), null]);

  const quitarUltimoIntento = (examen: Examen) => guardarExamen(examen, intentosDe(examen).slice(0, -1));

  const eliminarExamen = async (id: number) => {
    if (modoSesion === 'guest') {
      const nuevos = examenes.filter((e) => e.id !== id);
      setExamenes(nuevos);
      guardarGuestLocal({ examenes: nuevos });
      return;
    }
    if (!token) return;
    await fetch(`${BASE_API}/examenes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    cargarDatosAuth(token);
  };

  const agregarTp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tpMateriaId || !tpTitulo.trim() || !tpFecha) return;
    const matObj = materias.find((m) => m.id === Number(tpMateriaId));
    if (!matObj) return;

    if (modoSesion === 'guest') {
      const nuevoTp: TrabajoPractico = {
        id: Date.now(),
        materia_id: matObj.id,
        materia_nombre: matObj.nombre,
        titulo: tpTitulo,
        fecha_entrega: tpFecha,
        estado: 'pendiente',
        nota: null,
        descripcion: tpDescripcion || null,
      };
      const nuevos = [...tps, nuevoTp];
      setTps(nuevos);
      guardarGuestLocal({ tps: nuevos });
      setTpTitulo('');
      setTpFecha('');
      setTpDescripcion('');
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/tps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        materia_id: Number(tpMateriaId),
        titulo: tpTitulo,
        fecha_entrega: tpFecha,
        descripcion: tpDescripcion,
      }),
    });
    setTpTitulo('');
    setTpFecha('');
    setTpDescripcion('');
    cargarDatosAuth(token);
  };

  const actualizarTp = async (tp: TrabajoPractico, nuevoEstado: TrabajoPractico['estado']) => {
    let notaTp = tp.nota;
    if (nuevoEstado === 'aprobado' && notaTp === null) {
      const input = prompt(`Nota del TP "${tp.titulo}" (opcional, 1 a 10):`);
      if (input) notaTp = Number(input);
    }

    if (modoSesion === 'guest') {
      const nuevos = tps.map((t) => (t.id === tp.id ? { ...t, estado: nuevoEstado, nota: notaTp } : t));
      setTps(nuevos);
      guardarGuestLocal({ tps: nuevos });
      return;
    }

    if (!token) return;
    await fetch(`${BASE_API}/tps/${tp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ estado: nuevoEstado, nota: notaTp }),
    });
    cargarDatosAuth(token);
  };

  const eliminarTp = async (id: number) => {
    if (modoSesion === 'guest') {
      const nuevos = tps.filter((t) => t.id !== id);
      setTps(nuevos);
      guardarGuestLocal({ tps: nuevos });
      return;
    }
    if (!token) return;
    await fetch(`${BASE_API}/tps/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    cargarDatosAuth(token);
  };

  const alternarRequisito = (id: string) =>
    setCorrRequisitoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const agregarCorrelativa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCorr('');
    const ids = corrRequisitoIds.filter((id) => id !== corrMateriaId);
    if (!corrMateriaId || ids.length === 0) return;

    if (modoSesion === 'guest') {
      const mDest = materias.find((m) => m.id === Number(corrMateriaId));
      if (!mDest) return;
      const pares: Correlativa[] = [];
      for (const id of ids) {
        const mReq = materias.find((m) => m.id === Number(id));
        if (!mReq) continue;
        pares.push({
          materia_id: mDest.id,
          correlativa_id: mReq.id,
          tipo_requisito: corrTipo,
          materia_nombre: mDest.nombre,
          correlativa_nombre: mReq.nombre,
          correlativa_estado: mReq.estado,
        });
      }
      // si el vínculo ya existía, se reemplaza (permite cambiar la condición)
      const resto = correlativas.filter(
        (c) => !(c.materia_id === mDest.id && ids.includes(String(c.correlativa_id)))
      );
      const nuevas = [...resto, ...pares];
      setCorrelativas(nuevas);
      guardarGuestLocal({ correlativas: nuevas });
      setCorrRequisitoIds([]);
      return;
    }

    if (!token) return;
    try {
      const res = await fetch(`${BASE_API}/correlativas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          materia_id: Number(corrMateriaId),
          correlativa_ids: ids.map(Number),
          tipo_requisito: corrTipo,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorCorr(data.error || 'No se pudieron vincular las correlativas');
        return;
      }
      setCorrRequisitoIds([]);
      cargarDatosAuth(token);
    } catch {
      setErrorCorr('No se pudo conectar con el servidor');
    }
  };

  const eliminarCorrelativa = async (materia_id: number, correlativa_id: number) => {
    if (modoSesion === 'guest') {
      const nuevas = correlativas.filter(
        (c) => !(c.materia_id === materia_id && c.correlativa_id === correlativa_id)
      );
      setCorrelativas(nuevas);
      guardarGuestLocal({ correlativas: nuevas });
      return;
    }
    if (!token) return;
    await fetch(`${BASE_API}/correlativas/${materia_id}/${correlativa_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    cargarDatosAuth(token);
  };

  const calcularCuentaRegresivaCursada = () => {
    if (!usuario?.fin_cursada || ahora === 0) return null;
    const diff = new Date(usuario.fin_cursada).getTime() - ahora;
    if (diff <= 0) return { finalizado: true, dias: 0, horas: 0, minutos: 0, segundos: 0 };
    return {
      finalizado: false,
      dias: Math.floor(diff / (1000 * 60 * 60 * 24)),
      horas: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutos: Math.floor((diff / 1000 / 60) % 60),
      segundos: Math.floor((diff / 1000) % 60),
    };
  };

  const calcularDiasRestantes = (fechaStr: string) => {
    const [anio, mes, dia] = fechaStr.split('T')[0].split('-').map(Number);
    const fechaObj = new Date(anio, mes - 1, dia);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.round((fechaObj.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  };

  const verificarCorrelativasCumplidas = (materiaId: number) => {
    const reqs = correlativas.filter((c) => c.materia_id === materiaId);
    if (reqs.length === 0) return { habilitada: true, faltantes: [] as Correlativa[] };

    const faltantes = reqs.filter((r) => {
      const matActual = materias.find((m) => m.id === r.correlativa_id);
      const est = matActual ? matActual.estado : r.correlativa_estado;
      if (r.tipo_requisito === 'aprobada') return est !== 'aprobada';
      return est !== 'regular' && est !== 'aprobada';
    });

    return { habilitada: faltantes.length === 0, faltantes };
  };

  const generarCeldasCalendario = () => {
    const { anio, mes } = mesActual;
    const primerDiaSemana = new Date(anio, mes, 1).getDay();
    const offsetLunes = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const celdas: (number | null)[] = [];
    for (let i = 0; i < offsetLunes; i++) celdas.push(null);
    for (let d = 1; d <= diasEnMes; d++) celdas.push(d);
    return celdas;
  };

  if (verificandoSesion) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <p className="text-zinc-300">Cargando tu espacio académico...</p>
          <p className="text-xs text-zinc-500 max-w-xs">
            Si hace rato que no entrabas, el servidor puede tardar hasta un minuto en despertar.
          </p>
        </div>
      </main>
    );
  }

  const cerrarRecuperacion = () => {
    setVistaRecuperar(null);
    setResetToken('');
    setRecuPass('');
    setRecuPass2('');
    setRecuError('');
    setRecuMensaje('');
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
  };

  const enviarRecuperacion = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecuError('');
    setRecuMensaje('');
    setRecuCargando(true);
    try {
      const res = await fetch(`${BASE_API}/auth/recuperar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recuEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setRecuError(data.error || 'No se pudo enviar el correo');
      else setRecuMensaje(data.mensaje || 'Revisá tu correo para continuar.');
    } catch {
      setRecuError('No se pudo conectar con el servidor');
    } finally {
      setRecuCargando(false);
    }
  };

  const guardarNuevaPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecuError('');
    if (recuPass.length < 6) {
      setRecuError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (recuPass !== recuPass2) {
      setRecuError('Las contraseñas no coinciden');
      return;
    }
    setRecuCargando(true);
    try {
      const res = await fetch(`${BASE_API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, nuevaPassword: recuPass }),
      });
      const data = await res.json();
      if (!res.ok) setRecuError(data.error || 'No se pudo actualizar la contraseña');
      else {
        setRecuMensaje(data.mensaje || 'Contraseña actualizada correctamente');
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {
      setRecuError('No se pudo conectar con el servidor');
    } finally {
      setRecuCargando(false);
    }
  };

  if (vistaRecuperar) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Organizador Académico</h1>
            <p className="text-sm text-zinc-400">
              {vistaRecuperar === 'olvide' ? 'Recuperá tu contraseña' : 'Elegí tu nueva contraseña'}
            </p>
          </div>

          {recuError && (
            <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2.5 rounded-lg">
              {recuError}
            </div>
          )}

          {recuMensaje && (
            <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs px-3 py-2.5 rounded-lg">
              {recuMensaje}
            </div>
          )}

          {vistaRecuperar === 'olvide' && !recuMensaje && (
            <form onSubmit={enviarRecuperacion} className="space-y-4">
              <p className="text-xs text-zinc-400">
                Ingresá el correo de tu cuenta y te enviamos un enlace para crear una contraseña nueva.
              </p>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Correo electrónico</label>
                <input
                  type="email"
                  placeholder="tu@email.com"
                  value={recuEmail}
                  onChange={(e) => setRecuEmail(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={recuCargando}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-lg transition cursor-pointer"
              >
                {recuCargando ? 'Enviando...' : 'Enviar enlace de recuperación'}
              </button>
            </form>
          )}

          {vistaRecuperar === 'reset' && !recuMensaje && (
            <form onSubmit={guardarNuevaPassword} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nueva contraseña</label>
                <input
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={recuPass}
                  onChange={(e) => setRecuPass(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Repetí la contraseña</label>
                <input
                  type="password"
                  placeholder="Repetila"
                  value={recuPass2}
                  onChange={(e) => setRecuPass2(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={recuCargando}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-lg transition cursor-pointer"
              >
                {recuCargando ? 'Guardando...' : 'Guardar nueva contraseña'}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={cerrarRecuperacion}
            className="w-full text-xs text-blue-400 hover:underline cursor-pointer"
          >
            {recuMensaje && vistaRecuperar === 'reset' ? 'Ir a iniciar sesión' : '← Volver a iniciar sesión'}
          </button>
        </div>
      </main>
    );
  }

  if (!modoSesion || !usuario) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Organizador Académico</h1>
            <p className="text-sm text-zinc-400">
              Gestioná tu carrera, horarios, asistencias, parciales y correlativas
            </p>
          </div>

          <div className="grid grid-cols-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setModoAuth('login');
                setAuthError('');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                modoAuth === 'login' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setModoAuth('register');
                setAuthError('');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                modoAuth === 'register'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Crear Cuenta
            </button>
          </div>

          {authError && (
            <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2.5 rounded-lg">
              {authError}
            </div>
          )}

          <form onSubmit={(e) => manejarAuth(e, false)} className="space-y-4">
            {modoAuth === 'register' && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Tu nombre</label>
                <input
                  type="text"
                  placeholder="Ej: Axel"
                  value={authNombre}
                  onChange={(e) => setAuthNombre(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Correo electrónico</label>
              <input
                type="email"
                placeholder="tu@email.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label className="text-zinc-400">Contraseña</label>
                <button
                  type="button"
                  onClick={() => {
                    setRecuEmail(authEmail);
                    setRecuError('');
                    setRecuMensaje('');
                    setVistaRecuperar('olvide');
                  }}
                  className="text-blue-400 hover:underline cursor-pointer"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm"
                required
              />
            </div>

            {autenticando && (
              <p className="text-xs text-zinc-400 text-center">
                Conectando… si el servidor estaba dormido, puede tardar hasta un minuto.
              </p>
            )}

            <button
              type="submit"
              disabled={autenticando}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-wait text-white font-semibold text-sm py-2.5 rounded-lg transition cursor-pointer"
            >
              {autenticando
                ? 'Conectando...'
                : modoAuth === 'login'
                ? 'Entrar con mi cuenta'
                : 'Registrarme'}
            </button>
          </form>

          {/* Botones sociales de Google y Apple */}
          <div className="space-y-3 mt-4">
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-zinc-800"></div>
              <span className="flex-shrink mx-3 text-xs text-zinc-500">o continuar con</span>
              <div className="flex-grow border-t border-zinc-800"></div>
            </div>

            <button
              type="button"
              onClick={() => alert('Integrando Google OAuth...')}
              className="w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <span>🌐</span> Continuar con Google
            </button>

            <button
              type="button"
              onClick={() => alert('Integrando Apple Sign In...')}
              className="w-full bg-black hover:bg-zinc-900 border border-zinc-700 text-white text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <span></span> Continuar con Apple
            </button>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-zinc-800"></div>
            <span className="flex-shrink mx-3 text-xs text-zinc-500">o</span>
            <div className="flex-grow border-t border-zinc-800"></div>
          </div>

          <button
            type="button"
            onClick={entrarComoInvitado}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-sm py-2.5 rounded-lg border border-zinc-700 transition cursor-pointer"
          >
            Entrar sin cuenta (Modo Invitado)
          </button>
        </div>
      </main>
    );
  }

  const aprobadas = materias.filter((m) => m.estado === 'aprobada');
  const porcentajeCarrera =
    materias.length > 0 ? Math.round((aprobadas.length / materias.length) * 100) : 0;

  const notasValidas = aprobadas.filter((m) => m.nota_final !== null).map((m) => Number(m.nota_final));
  const promedio =
    notasValidas.length > 0
      ? (notasValidas.reduce((acc, n) => acc + n, 0) / notasValidas.length).toFixed(2)
      : '-';

  // Foto de perfil, o un círculo con las iniciales si no hay foto
  const renderAvatar = (tamano: string, textoTamano: string) =>
    usuario?.foto ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={usuario.foto}
        alt="Foto de perfil"
        className={`${tamano} rounded-full object-cover border-2 border-zinc-700 shrink-0`}
      />
    ) : (
      <span
        className={`${tamano} ${textoTamano} rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-white font-bold flex items-center justify-center border-2 border-zinc-700 shrink-0`}
      >
        {iniciales(usuario?.nombre || '')}
      </span>
    );

  const materiasFiltradas = materias.filter((m) => {
    const coincideTexto = m.nombre.toLowerCase().includes(busqueda.toLowerCase());
    const coincideAnio = filtroAnio === 'todos' || m.anio_carrera === Number(filtroAnio);
    const coincideEstado = filtroEstado === 'todos' || m.estado === filtroEstado;
    return coincideTexto && coincideAnio && coincideEstado;
  });

  const coloresEstadoMateria: Record<Materia['estado'], string> = {
    pendiente: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    cursando: 'bg-blue-950 text-blue-300 border-blue-800',
    regular: 'bg-amber-950 text-amber-300 border-amber-600',
    aprobada: 'bg-emerald-950 text-emerald-300 border-emerald-600',
    desaprobada: 'bg-red-950 text-red-300 border-red-600',
  };

  const bordeTarjetaMateria: Record<Materia['estado'], string> = {
    pendiente: 'border-zinc-800',
    cursando: 'border-blue-900/70',
    regular: 'border-amber-700/70',
    aprobada: 'border-emerald-700/70',
    desaprobada: 'border-red-700/70',
  };

  const coloresCondicionExamen: Record<Examen['condicion'], string> = {
    pendiente: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    aprobado: 'bg-emerald-950 text-emerald-300 border-emerald-700',
    promociona: 'bg-purple-950 text-purple-300 border-purple-700',
    desaprobado: 'bg-red-950 text-red-300 border-red-700',
  };

  const prefijoMesActual = `${mesActual.anio}-${String(mesActual.mes + 1).padStart(2, '0')}`;
  const fechaFiltroAgenda = diaSeleccionado || prefijoMesActual;
  const examenesAgenda = examenes.filter((ex) => ex.fecha.startsWith(fechaFiltroAgenda));
  const tpsAgenda = tps.filter((tp) => tp.fecha_entrega.startsWith(fechaFiltroAgenda));

  const cumpleRequisito = (c: Correlativa) => {
    const matReq = materias.find((m) => m.id === c.correlativa_id);
    const est = matReq ? matReq.estado : c.correlativa_estado;
    return c.tipo_requisito === 'aprobada' ? est === 'aprobada' : est === 'regular' || est === 'aprobada';
  };

  type GrupoCorrelativas = { materia_id: number; nombre: string; reqs: Correlativa[] };
  const gruposMap: Record<number, GrupoCorrelativas> = {};
  for (const c of correlativas as Correlativa[]) {
    if (!gruposMap[c.materia_id]) {
      gruposMap[c.materia_id] = {
        materia_id: c.materia_id,
        nombre: c.materia_nombre || materias.find((m) => m.id === c.materia_id)?.nombre || 'Materia',
        reqs: [],
      };
    }
    gruposMap[c.materia_id].reqs.push(c);
  }
  const correlativasPorMateria: GrupoCorrelativas[] = (Object.values(gruposMap) as GrupoCorrelativas[]).sort(
    (a, b) => a.nombre.localeCompare(b.nombre)
  );

  const proximosVencimientos = [
    ...examenes
      .map((ex) => ({
        clave: `ex-${ex.id}`,
        tipo: 'Examen',
        titulo: ex.titulo,
        materia: ex.materia_nombre,
        dias: calcularDiasRestantes(ex.fecha),
      }))
      .filter((x) => x.dias >= 0 && x.dias <= 7),
    ...tps
      .filter((tp) => tp.estado === 'pendiente' || tp.estado === 'rehacer')
      .map((tp) => ({
        clave: `tp-${tp.id}`,
        tipo: 'TP',
        titulo: tp.titulo,
        materia: tp.materia_nombre,
        dias: calcularDiasRestantes(tp.fecha_entrega),
      }))
      .filter((x) => x.dias <= 7),
  ].sort((a, b) => a.dias - b.dias);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-4 sm:p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/80 border border-zinc-800 rounded-2xl px-4 sm:px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={alternarPanelUsuario}
              aria-expanded={panelUsuarioAbierto}
              title="Ver mi perfil"
              className="flex items-center gap-3 text-left cursor-pointer rounded-xl hover:bg-zinc-800/60 pr-3 transition"
            >
              {renderAvatar('h-11 w-11', 'text-sm')}
              <span className="flex flex-col">
                <span className="text-base sm:text-lg font-semibold text-zinc-100 leading-tight">
                  👋 ¡Bienvenido, <span className="text-blue-400">{usuario.nombre}</span>!
                </span>
                <span className="text-xs text-zinc-400">
                  {usuario.carrera || 'Tocá para ver tu perfil'} {panelUsuarioAbierto ? '▲' : '▼'}
                </span>
              </span>
            </button>
            {modoSesion === 'guest' && (
              <span className="text-xs bg-amber-950/70 text-amber-300 border border-amber-800/60 px-2.5 py-0.5 rounded-full">
                Modo Invitado
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {modoSesion === 'guest' && (
              <button
                onClick={() => {
                  setAuthError('');
                  setMostrarModalMigracion(true);
                }}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                ☁ Guardar datos en una cuenta
              </button>
            )}
            <button
              onClick={salir}
              className="text-xs text-zinc-400 hover:text-red-400 underline cursor-pointer"
            >
              {modoSesion === 'guest' ? 'Salir' : 'Cerrar sesión'}
            </button>
          </div>
        </div>

        {panelUsuarioAbierto && (
          <section className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row gap-6 sm:items-start">
              <div className="flex flex-col items-center gap-2.5 sm:w-40">
                {renderAvatar('h-24 w-24', 'text-3xl')}
                <div className="flex items-center gap-3">
                  <label className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 px-2.5 py-1 rounded-lg cursor-pointer transition">
                    {usuario.foto ? 'Cambiar foto' : 'Subir foto'}
                    <input type="file" accept="image/*" onChange={cambiarFoto} className="hidden" />
                  </label>
                  {usuario.foto && (
                    <button
                      type="button"
                      onClick={() => guardarPerfil({ foto: null })}
                      className="text-xs text-zinc-400 hover:text-red-400 underline cursor-pointer"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={guardarDatosPerfil} className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Nombre</label>
                  <input
                    type="text"
                    value={perfilNombre}
                    onChange={(e) => setPerfilNombre(e.target.value)}
                    maxLength={80}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Correo electrónico</label>
                  <input
                    type="text"
                    value={modoSesion === 'guest' ? 'Sin cuenta (modo invitado)' : usuario.email}
                    disabled
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-zinc-400 mb-1">Carrera que estudiás</label>
                  <input
                    type="text"
                    placeholder="Ej: Lic. en Sistemas de Información"
                    value={perfilCarrera}
                    onChange={(e) => setPerfilCarrera(e.target.value)}
                    maxLength={120}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={perfilGuardando}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm px-4 py-2 rounded-lg transition cursor-pointer"
                  >
                    {perfilGuardando ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </form>
            </div>

            {perfilError && (
              <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2.5 rounded-lg">
                {perfilError}
              </div>
            )}
            {perfilMsg && (
              <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs px-3 py-2.5 rounded-lg">
                {perfilMsg}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-[10px] text-zinc-400 uppercase">Aprobadas</p>
                <p className="text-lg font-bold text-emerald-400">
                  {aprobadas.length}
                  <span className="text-xs text-zinc-500">/{materias.length}</span>
                </p>
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-[10px] text-zinc-400 uppercase">Avance</p>
                <p className="text-lg font-bold text-purple-400">{porcentajeCarrera}%</p>
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-[10px] text-zinc-400 uppercase">Promedio</p>
                <p className="text-lg font-bold text-blue-400">{promedio}</p>
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-[10px] text-zinc-400 uppercase">Fin de cursada</p>
                <p className="text-sm font-bold text-zinc-200 mt-1">
                  {usuario.fin_cursada
                    ? new Date(usuario.fin_cursada).toLocaleDateString('es-AR')
                    : 'Sin definir'}
                </p>
              </div>
            </div>

            {modoSesion === 'auth' && (
              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setPassError('');
                    setPassMsg('');
                    setMostrarCambioPass(!mostrarCambioPass);
                  }}
                  className="text-xs text-blue-400 hover:underline cursor-pointer"
                >
                  {mostrarCambioPass ? '▲ Ocultar' : '🔒 Cambiar contraseña'}
                </button>

                {mostrarCambioPass && (
                  <form onSubmit={cambiarPassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Contraseña actual</label>
                      <input
                        type="password"
                        value={passActual}
                        onChange={(e) => setPassActual(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Contraseña nueva</label>
                      <input
                        type="password"
                        placeholder="Mínimo 6 caracteres"
                        value={passNueva}
                        onChange={(e) => setPassNueva(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Repetí la nueva</label>
                      <input
                        type="password"
                        value={passNueva2}
                        onChange={(e) => setPassNueva2(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={passGuardando}
                        className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-zinc-100 text-sm font-medium px-4 py-2 rounded-lg border border-zinc-700 transition cursor-pointer"
                      >
                        {passGuardando ? 'Guardando...' : 'Actualizar contraseña'}
                      </button>
                      {passError && <span className="text-xs text-red-400">{passError}</span>}
                      {passMsg && <span className="text-xs text-emerald-400">{passMsg}</span>}
                    </div>
                  </form>
                )}
              </div>
            )}

            {modoSesion === 'guest' && (
              <p className="text-xs text-amber-300/90 border-t border-zinc-800 pt-4">
                Estás en modo invitado: tus datos solo viven en este navegador. Para tener correo y
                contraseña, usá &quot;Guardar datos en una cuenta&quot;.
              </p>
            )}
          </section>
        )}

        {materiaEditando && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <form
              onSubmit={guardarEdicion}
              className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-bold text-white">Editar materia</h2>
                <button
                  type="button"
                  onClick={() => setMateriaEditando(null)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {errorEdit && (
                <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2.5 rounded-lg">
                  {errorEdit}
                </div>
              )}

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nombre</label>
                <input
                  type="text"
                  value={formEdit.nombre}
                  onChange={(e) => setCampoEdit('nombre', e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Año de la carrera</label>
                  <select
                    value={formEdit.anio_carrera}
                    onChange={(e) => setCampoEdit('anio_carrera', e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6].map((a) => (
                      <option key={a} value={a}>
                        {a}° Año
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Cuatrimestre</label>
                  <select
                    value={formEdit.cuatrimestre}
                    onChange={(e) => setCampoEdit('cuatrimestre', e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="1ro">1ro</option>
                    <option value="2do">2do</option>
                    <option value="Anual">Anual</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Estado</label>
                <select
                  value={formEdit.estado}
                  onChange={(e) => setCampoEdit('estado', e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="cursando">Cursando</option>
                  <option value="regular">Regular</option>
                  <option value="aprobada">Aprobada</option>
                  <option value="desaprobada">Desaprobada</option>
                </select>
              </div>

              {formEdit.estado === 'aprobada' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Nota final (1 a 10)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      max="10"
                      value={formEdit.nota_final}
                      onChange={(e) => setCampoEdit('nota_final', e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Cómo la aprobaste</label>
                    <select
                      value={formEdit.modalidad_aprobacion}
                      onChange={(e) => setCampoEdit('modalidad_aprobacion', e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="promocionada">Promocionada</option>
                      <option value="final">Por final</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Asist. mínima %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formEdit.asistencia_minima}
                    onChange={(e) => setCampoEdit('asistencia_minima', e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Clases totales</label>
                  <input
                    type="number"
                    min="0"
                    value={formEdit.clases_totales}
                    onChange={(e) => setCampoEdit('clases_totales', e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Inasistencias</label>
                  <input
                    type="number"
                    min="0"
                    value={formEdit.inasistencias}
                    onChange={(e) => setCampoEdit('inasistencias', e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-2.5 rounded-lg transition cursor-pointer"
                >
                  Guardar cambios
                </button>
                <button
                  type="button"
                  onClick={() => setMateriaEditando(null)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-4 py-2.5 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {materiaPorBorrar && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-zinc-900 border border-red-900/70 rounded-2xl p-6 space-y-4 shadow-2xl">
              <h2 className="text-lg font-bold text-red-400">¿Borrar esta materia?</h2>
              <p className="text-sm text-zinc-300">
                <strong>{materiaPorBorrar.nombre}</strong> se borra junto con sus horarios, exámenes,
                TPs y correlativas. No se puede deshacer.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const id = materiaPorBorrar.id;
                    setMateriaPorBorrar(null);
                    await eliminarMateria(id);
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm py-2.5 rounded-lg transition cursor-pointer"
                >
                  Sí, borrar
                </button>
                <button
                  type="button"
                  onClick={() => setMateriaPorBorrar(null)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-4 py-2.5 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {mostrarReset && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-zinc-900 border border-red-900/70 rounded-2xl p-6 space-y-4 shadow-2xl">
              <h2 className="text-lg font-bold text-red-400">¿Borrar todas las materias?</h2>
              <p className="text-sm text-zinc-300">
                Vas a borrar tus <strong>{materias.length}</strong> materias y también todo lo que
                depende de ellas: horarios, exámenes, TPs y correlativas. Esta acción no se puede
                deshacer.
              </p>

              {errorReset && (
                <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2.5 rounded-lg">
                  {errorReset}
                </div>
              )}

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Para confirmar, escribí <span className="font-mono text-red-400">BORRAR</span>
                </label>
                <input
                  type="text"
                  value={textoReset}
                  onChange={(e) => setTextoReset(e.target.value)}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetearMaterias}
                  disabled={textoReset.trim().toUpperCase() !== 'BORRAR' || reseteando}
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition cursor-pointer"
                >
                  {reseteando ? 'Borrando...' : 'Sí, borrar todo'}
                </button>
                <button
                  type="button"
                  onClick={() => setMostrarReset(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-4 py-2.5 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {mostrarModalMigracion && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-5 shadow-2xl">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white">Pasar tus datos a una cuenta</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Se migrarán tus {materias.length} materias, horarios, exámenes y TPs a la nube.
                  </p>
                </div>
                <button
                  onClick={() => setMostrarModalMigracion(false)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setModoAuth('register')}
                  className={`py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                    modoAuth === 'register' ? 'bg-blue-600 text-white' : 'text-zinc-400'
                  }`}
                >
                  Crear Cuenta Nueva
                </button>
                <button
                  type="button"
                  onClick={() => setModoAuth('login')}
                  className={`py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                    modoAuth === 'login' ? 'bg-blue-600 text-white' : 'text-zinc-400'
                  }`}
                >
                  Ya Tengo Cuenta
                </button>
              </div>

              {authError && (
                <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2 rounded-lg">
                  {authError}
                </div>
              )}

              <form onSubmit={(e) => manejarAuth(e, true)} className="space-y-3">
                {modoAuth === 'register' && (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Tu nombre</label>
                    <input
                      type="text"
                      placeholder="Ej: Axel"
                      value={authNombre}
                      onChange={(e) => setAuthNombre(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Correo electrónico</label>
                  <input
                    type="email"
                    placeholder="tu@email.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Contraseña</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={migrando}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm py-2.5 rounded-lg cursor-pointer"
                >
                  {migrando ? 'Migrando datos...' : 'Confirmar y migrar mis datos'}
                </button>
              </form>
            </div>
          </div>
        )}

        <section className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-blue-950/40 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-center md:text-left">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
              Fin de la cursada
            </span>
            {!calcularCuentaRegresivaCursada() ? (
              <p className="text-zinc-300 text-sm mt-1">
                Definí cuándo termina tu cursada para iniciar la cuenta regresiva en vivo.
              </p>
            ) : calcularCuentaRegresivaCursada()?.finalizado ? (
              <h2 className="text-2xl sm:text-3xl font-extrabold text-emerald-400 mt-1">
                ¡FIN DE CURSADA!
              </h2>
            ) : (
              <div className="flex items-center justify-center md:justify-start gap-2 sm:gap-3 mt-2 font-mono">
                {[
                  { val: calcularCuentaRegresivaCursada()?.dias ?? 0, label: 'Días', color: 'text-white' },
                  { val: calcularCuentaRegresivaCursada()?.horas ?? 0, label: 'Horas', color: 'text-white' },
                  { val: calcularCuentaRegresivaCursada()?.minutos ?? 0, label: 'Min', color: 'text-white' },
                  { val: calcularCuentaRegresivaCursada()?.segundos ?? 0, label: 'Seg', color: 'text-blue-400' },
                ].map((b, i) => (
                  <div key={b.label} className="flex items-center gap-2 sm:gap-3">
                    {i > 0 && <span className="text-zinc-600 font-bold">:</span>}
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 sm:px-3 py-1.5 text-center">
                      <span className={`text-lg sm:text-2xl font-bold ${b.color}`}>
                        {String(b.val).padStart(2, '0')}
                      </span>
                      <p className="text-[10px] text-zinc-400 uppercase">{b.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editandoFin ? (
            <form onSubmit={guardarFinCursada} className="flex flex-wrap items-center justify-center gap-2">
              <input
                type="datetime-local"
                value={inputFinCursada}
                onChange={(e) => setInputFinCursada(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                required
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-2 rounded-lg cursor-pointer"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEditandoFin(false)}
                className="bg-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <button
              onClick={() => setEditandoFin(true)}
              className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3.5 py-2 rounded-lg border border-zinc-700 transition cursor-pointer"
            >
              {usuario.fin_cursada ? 'Cambiar fecha fin' : 'Definir fecha fin'}
            </button>
          )}
        </section>

        {proximosVencimientos.length > 0 && (
          <section className="bg-zinc-900/80 border border-amber-900/50 rounded-2xl p-4 sm:p-5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              ⏰ Próximos 7 días
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {proximosVencimientos.map((x) => (
                <div
                  key={x.clave}
                  className="flex items-center justify-between gap-3 bg-zinc-950/70 border border-zinc-800 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {x.tipo}: {x.titulo}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">{x.materia}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
                      x.dias < 0
                        ? 'bg-red-950 text-red-300'
                        : x.dias <= 1
                        ? 'bg-amber-950 text-amber-300'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {x.dias < 0
                      ? `Vencido hace ${Math.abs(x.dias)}d`
                      : x.dias === 0
                      ? 'Hoy'
                      : x.dias === 1
                      ? 'Mañana'
                      : `En ${x.dias} días`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <header className="space-y-4 border-b border-zinc-800 pb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Organizador Académico
              </h1>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportarReportePDF}
                  disabled={materias.length === 0}
                  className="text-xs bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  📄 Exportar PDF / Imprimir
                </button>
                <button
                  type="button"
                  onClick={exportarCSV}
                  disabled={materias.length === 0}
                  className="text-xs bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  📊 Exportar Excel (CSV)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-center">
                <p className="text-[10px] sm:text-xs text-zinc-400 uppercase">Aprobadas</p>
                <p className="text-lg sm:text-2xl font-bold text-emerald-400">
                  {aprobadas.length}
                  <span className="text-xs sm:text-sm text-zinc-500">/{materias.length}</span>
                </p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-center">
                <p className="text-[10px] sm:text-xs text-zinc-400 uppercase">Avance</p>
                <p className="text-lg sm:text-2xl font-bold text-purple-400">{porcentajeCarrera}%</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-center">
                <p className="text-[10px] sm:text-xs text-zinc-400 uppercase">Promedio</p>
                <p className="text-lg sm:text-2xl font-bold text-blue-400">{promedio}</p>
              </div>
            </div>
          </div>

          <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-zinc-800">
            <div
              className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-500"
              style={{ width: `${porcentajeCarrera}%` }}
            />
          </div>
        </header>

        <nav className="flex overflow-x-auto gap-2 border-b border-zinc-800 pb-3 no-scrollbar">
          {[
            { id: 'materias', label: `Materias (${materias.length})` },
            { id: 'horarios', label: `Horarios (${horarios.length})` },
            { id: 'examenes', label: `Parciales (${examenes.length})` },
            { id: 'tps', label: `TPs (${tps.length})` },
            { id: 'calendario', label: 'Calendario' },
            { id: 'correlativas', label: `Correlativas (${correlativas.length})` },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as typeof tab)}
              className={`whitespace-nowrap px-3.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition cursor-pointer ${
                tab === item.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {tab === 'materias' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-end gap-2">
              {materias.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorReset('');
                    setTextoReset('');
                    setMostrarReset(true);
                  }}
                  className="text-xs bg-zinc-900 hover:bg-red-950/60 text-red-400 border border-red-900/60 px-3.5 py-2 rounded-lg font-medium cursor-pointer"
                >
                  🗑 Borrar todas las materias
                </button>
              )}
              <button
                type="button"
                onClick={() => setMostrarImportador(!mostrarImportador)}
                className="text-xs bg-zinc-900 hover:bg-zinc-800 text-blue-400 border border-blue-900/60 px-3.5 py-2 rounded-lg font-medium cursor-pointer"
              >
                {mostrarImportador ? 'Cerrar importador' : '📥 Importar Plan de Estudios'}
              </button>
            </div>

            {mostrarImportador && (
              <div className="bg-zinc-900 border border-blue-900/60 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100">Importación rápida</h3>
                    <p className="text-xs text-zinc-400">
                      Una materia por línea:{' '}
                      <code className="text-blue-400">Nombre | Año (1-6) | Cuatrimestre</code>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => importarPlan(PLAN_EJEMPLO_SISTEMAS)}
                    className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-700 px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    Plantilla Sistemas (13 materias)
                  </button>
                </div>

                <form onSubmit={procesarTextoImportacion} className="space-y-3">
                  <textarea
                    rows={4}
                    placeholder={`Análisis Matemático I | 1 | 1ro\nFísica I | 1 | 2do`}
                    value={textoImportar}
                    onChange={(e) => setTextoImportar(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-xs font-mono"
                    required
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer"
                  >
                    Importar materias
                  </button>
                </form>
              </div>
            )}

            <form
              onSubmit={agregarMateria}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 sm:gap-4 items-end"
            >
              <div className="sm:col-span-2">
                <label className="block text-xs text-zinc-400 mb-1">Nombre de la materia</label>
                <input
                  type="text"
                  placeholder="Ej: Sistemas Operativos"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Año</label>
                <select
                  value={anioCarrera}
                  onChange={(e) => setAnioCarrera(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5, 6].map((a) => (
                    <option key={a} value={a}>
                      {a}° Año
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Cuatrimestre</label>
                <select
                  value={cuatrimestre}
                  onChange={(e) => setCuatrimestre(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="1ro">1° Cuatrimestre</option>
                  <option value="2do">2° Cuatrimestre</option>
                  <option value="Anual">Anual</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Estado</label>
                <select
                  value={estado}
                  onChange={(e) => setEstado(e.target.value as Materia['estado'])}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="cursando">Cursando</option>
                  <option value="regular">Regular</option>
                  <option value="aprobada">Aprobada</option>
                  <option value="desaprobada">Desaprobada</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Asist. Mín (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={asistenciaMinima}
                  onChange={(e) => setAsistenciaMinima(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm py-2 px-4 rounded-lg transition cursor-pointer"
              >
                + Agregar
              </button>

              {estado === 'aprobada' && (
                <>
                  <div className="sm:col-span-1 lg:col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Modalidad</label>
                    <select
                      value={modalidadAprobacion}
                      onChange={(e) =>
                        setModalidadAprobacion(e.target.value as 'promocionada' | 'final')
                      }
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="promocionada">Promocionada</option>
                      <option value="final">Por Examen Final</option>
                    </select>
                  </div>

                  <div className="sm:col-span-1 lg:col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Nota final (1 a 10)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="10"
                      placeholder="Ej: 8"
                      value={notaFinal}
                      onChange={(e) => setNotaFinal(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}
            </form>

            {materias.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  placeholder="🔍 Buscar materia..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-2 sm:flex gap-2">
                  <select
                    value={filtroAnio}
                    onChange={(e) => setFiltroAnio(e.target.value)}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs sm:text-sm"
                  >
                    <option value="todos">Todos los años</option>
                    {[1, 2, 3, 4, 5, 6].map((a) => (
                      <option key={a} value={a}>
                        {a}° Año
                      </option>
                    ))}
                  </select>
                  <select
                    value={filtroEstado}
                    onChange={(e) => setFiltroEstado(e.target.value)}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs sm:text-sm"
                  >
                    <option value="todos">Todos estados</option>
                    <option value="cursando">Cursando</option>
                    <option value="pendiente">Pendiente</option>
                    <option value="regular">Regular</option>
                    <option value="aprobada">Aprobada</option>
                    <option value="desaprobada">Desaprobada</option>
                  </select>
                </div>
              </div>
            )}

            {materiasFiltradas.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl">
                <p className="text-zinc-400 text-sm">
                  {materias.length === 0
                    ? 'Todavía no cargaste ninguna materia.'
                    : 'Ninguna materia coincide con los filtros.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {materiasFiltradas.map((m) => {
                  const { habilitada, faltantes } = verificarCorrelativasCumplidas(m.id);
                  const presentes = Math.max(0, m.clases_totales - m.inasistencias);
                  const pctAsistencia =
                    m.clases_totales > 0 ? Math.round((presentes / m.clases_totales) * 100) : 100;
                  const enRiesgoAsistencia =
                  m.clases_totales > 0 && pctAsistencia < (m.asistencia_minima ?? 0);

                  return (
                    <div
                      key={m.id}
                      className={`bg-zinc-900 border-2 rounded-xl p-4 flex flex-col justify-between gap-3 ${bordeTarjetaMateria[m.estado]}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              {m.anio_carrera}° Año · {m.cuatrimestre}
                            </span>

                            {m.estado === 'aprobada' && m.modalidad_aprobacion && (
                              <button
                                onClick={() =>
                                  actualizarMateria({
                                    ...m,
                                    modalidad_aprobacion:
                                      m.modalidad_aprobacion === 'promocionada'
                                        ? 'final'
                                        : 'promocionada',
                                  })
                                }
                                className={`text-xs font-semibold px-2 py-0.5 rounded cursor-pointer ${
                                  m.modalidad_aprobacion === 'promocionada'
                                    ? 'bg-emerald-900/70 text-emerald-200 border border-emerald-600'
                                    : 'bg-teal-950 text-teal-300 border border-teal-700'
                                }`}
                              >
                                {m.modalidad_aprobacion === 'promocionada'
                                  ? '★ Promocionada'
                                  : '✓ Por Final'}
                              </button>
                            )}

                            {m.estado === 'aprobada' && m.nota_final !== null && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-600 text-white">
                                Nota: {m.nota_final}
                              </span>
                            )}

                            {m.estado === 'pendiente' && (
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  habilitada
                                    ? 'bg-emerald-950/70 text-emerald-400'
                                    : 'bg-red-950/70 text-red-400'
                                }`}
                              >
                                {habilitada ? 'Habilitada' : 'Bloqueada'}
                              </span>
                            )}
                          </div>
                          <h2
                            onClick={() => abrirEdicion(m)}
                            title="Tocá para editar la materia"
                            className="text-base sm:text-lg font-semibold mt-1.5 cursor-pointer hover:text-blue-400 transition"
                          >
                            {m.nombre}
                          </h2>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={m.estado}
                            onChange={(e) => cambiarEstado(m, e.target.value as Materia['estado'])}
                            className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer ${coloresEstadoMateria[m.estado]}`}
                          >
                            <option value="pendiente">Pendiente</option>
                            <option value="cursando">Cursando</option>
                            <option value="regular">Regular</option>
                            <option value="aprobada">Aprobada</option>
                            <option value="desaprobada">Desaprobada</option>
                          </select>
                          <button
                            onClick={() => abrirEdicion(m)}
                            title="Editar materia"
                            className="text-zinc-500 hover:text-blue-400 p-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => setMateriaPorBorrar(m)}
                            className="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-400">Asist.:</span>
                          <span
                            className={`font-bold ${
                              enRiesgoAsistencia ? 'text-red-400' : 'text-emerald-400'
                            }`}
                          >
                            {pctAsistencia}%
                          </span>
                          <span className="text-zinc-500">
                            ({presentes}/{m.clases_totales} · mín {m.asistencia_minima}%)
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              actualizarMateria({ ...m, clases_totales: m.clases_totales + 1 })
                            }
                            className="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/70 px-2 py-0.5 rounded cursor-pointer"
                          >
                            + Presente
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              actualizarMateria({
                                ...m,
                                clases_totales: m.clases_totales + 1,
                                inasistencias: m.inasistencias + 1,
                              })
                            }
                            className="bg-red-950 hover:bg-red-900 text-red-300 border border-red-800/70 px-2 py-0.5 rounded cursor-pointer"
                          >
                            + Falta ({m.inasistencias})
                          </button>
                          {m.clases_totales > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                actualizarMateria({ ...m, clases_totales: 0, inasistencias: 0 })
                              }
                              className="text-zinc-500 hover:text-zinc-300 px-1 cursor-pointer"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      </div>

                      {!habilitada && (
                        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-1.5">
                          Falta:{' '}
                          {faltantes
                            .map((f) => `${f.correlativa_nombre} (${f.tipo_requisito})`)
                            .join(', ')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'horarios' && (
          <div className="space-y-6">
            <form
              onSubmit={agregarHorario}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 items-end"
            >
              <div className="sm:col-span-2">
                <label className="block text-xs text-zinc-400 mb-1">Materia</label>
                <select
                  value={horMateriaId}
                  onChange={(e) => setHorMateriaId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Seleccionar materia...</option>
                  {materias.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Día</label>
                <select
                  value={horDia}
                  onChange={(e) => setHorDia(e.target.value as Horario['dia_semana'])}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {DIAS_CURSADA.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Desde</label>
                  <input
                    type="time"
                    value={horInicio}
                    onChange={(e) => setHorInicio(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-2 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Hasta</label>
                  <input
                    type="time"
                    value={horFin}
                    onChange={(e) => setHorFin(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-2 text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Aula (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: Aula 4 / Virtual"
                  value={horAula}
                  onChange={(e) => setHorAula(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm py-2 px-4 rounded-lg transition cursor-pointer"
              >
                + Agregar
              </button>
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
              {DIAS_CURSADA.map((dia) => {
                const bloques = horarios
                  .filter((h) => h.dia_semana === dia)
                  .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

                return (
                  <div
                    key={dia}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-3 min-h-36 sm:min-h-48"
                  >
                    <h3 className="text-sm font-bold text-center text-blue-400 border-b border-zinc-800 pb-2">
                      {dia}
                    </h3>
                    {bloques.length === 0 ? (
                      <p className="text-xs text-zinc-600 text-center pt-4">Libre</p>
                    ) : (
                      <div className="space-y-2">
                        {bloques.map((b) => (
                          <div
                            key={b.id}
                            className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs space-y-1"
                          >
                            <div className="flex justify-between items-start gap-1">
                              <span className="font-mono text-[11px] text-emerald-400 font-semibold">
                                {b.hora_inicio} - {b.hora_fin}
                              </span>
                              <button
                               onClick={() => eliminarHorario(b.id!)}
                                className="text-zinc-600 hover:text-red-400 cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                            <p className="font-semibold text-zinc-100 leading-snug">
                              {b.materia_nombre}
                            </p>
                            {b.aula && (
                              <span className="inline-block text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">
                                📍 {b.aula}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'examenes' && (
          <div className="space-y-6">
            <form
              onSubmit={agregarExamen}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 items-end"
            >
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Materia</label>
                <select
                  value={examMateriaId}
                  onChange={(e) => setExamMateriaId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Seleccionar...</option>
                  {materias.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Instancia</label>
                <input
                  type="text"
                  placeholder="Ej: 1er Parcial / Final"
                  value={examTitulo}
                  onChange={(e) => setExamTitulo(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Fecha</label>
                <input
                  type="date"
                  value={examFecha}
                  onChange={(e) => setExamFecha(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Temas / Notas</label>
                <input
                  type="text"
                  placeholder="Ej: Unidades 1 a 3"
                  value={examNotas}
                  onChange={(e) => setExamNotas(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm py-2 px-4 rounded-lg transition cursor-pointer"
              >
                + Agendar
              </button>
            </form>

            {examenes.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl">
                <p className="text-zinc-400 text-sm">No tenés exámenes agendados.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {examenes.map((ex) => {
                  const dias = calcularDiasRestantes(ex.fecha);
                  const badgeDias =
                    dias < 0
                      ? `Rendido hace ${Math.abs(dias)}d`
                      : dias === 0
                      ? '¡ES HOY!'
                      : `Faltan ${dias} día${dias === 1 ? '' : 's'}`;

                  return (
                    <div
                      key={ex.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-blue-400">
                            {ex.materia_nombre}
                          </span>
                          <span className="text-zinc-600">•</span>
                          <span className="text-xs text-zinc-400">
                            {ex.fecha.split('T')[0].split('-').reverse().join('/')}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            {badgeDias}
                          </span>
                        </div>
                        <h3 className="text-base font-semibold">{ex.titulo}</h3>
                        {ex.notas_estudio && (
                          <p className="text-xs text-zinc-400">{ex.notas_estudio}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 bg-zinc-950/80 border border-zinc-800/80 p-3 rounded-xl">
                        {(intentosDe(ex).length > 0 ? intentosDe(ex) : [null]).map((n, i) => (
                          <div key={`${ex.id}-${i}-${n ?? ''}`}>
                            <label className="block text-[10px] text-zinc-400 uppercase">
                              {i + 1}° Intento
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="10"
                              placeholder="-"
                              defaultValue={n ?? ''}
                              onBlur={(e) => cambiarIntento(ex, i, e.target.value)}
                              className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-center mt-0.5"
                            />
                          </div>
                        ))}

                        <div className="flex items-center gap-1 self-end pb-0.5">
                          <button
                            type="button"
                            onClick={() => agregarIntento(ex)}
                            title="Agregar otro intento"
                            className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 px-2 py-1 rounded cursor-pointer"
                          >
                            + Intento
                          </button>
                          {intentosDe(ex).length > 0 && (
                            <button
                              type="button"
                              onClick={() => quitarUltimoIntento(ex)}
                              title="Quitar el último intento"
                              className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 px-2 py-1 rounded cursor-pointer"
                            >
                              −
                            </button>
                          )}
                        </div>

                        <div className="text-center px-2 border-l border-zinc-800">
                          <span className="block text-[10px] text-zinc-400 uppercase">
                            Más Alta
                          </span>
                          <span className="text-base font-extrabold text-emerald-400">
                            {mejorNota(intentosDe(ex)) ?? '-'}
                          </span>
                        </div>

                        <div>
                          <label className="block text-[10px] text-zinc-400 uppercase mb-0.5">
                            Condición
                          </label>
                          <select
                            value={ex.condicion}
                            onChange={(e) =>
                              guardarExamen(ex, intentosDe(ex), e.target.value as Examen['condicion'])
                            }
                            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border cursor-pointer ${
                              coloresCondicionExamen[ex.condicion]
                            }`}
                          >
                            <option value="pendiente">Pendiente</option>
                            <option value="aprobado">Aprobado</option>
                            <option value="promociona">Promociona</option>
                            <option value="desaprobado">Desaprobado</option>
                          </select>
                        </div>

                        <button
                          onClick={() => eliminarExamen(ex.id!)}
                          className="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'tps' && (
          <div className="space-y-6">
            <form
              onSubmit={agregarTp}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 items-end"
            >
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Materia</label>
                <select
                  value={tpMateriaId}
                  onChange={(e) => setTpMateriaId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Seleccionar...</option>
                  {materias.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Trabajo Práctico</label>
                <input
                  type="text"
                  placeholder="Ej: TP N°2 - API REST"
                  value={tpTitulo}
                  onChange={(e) => setTpTitulo(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Fecha de entrega</label>
                <input
                  type="date"
                  value={tpFecha}
                  onChange={(e) => setTpFecha(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Consigna / Grupo</label>
                <input
                  type="text"
                  placeholder="Ej: Subir repo a GitHub"
                  value={tpDescripcion}
                  onChange={(e) => setTpDescripcion(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                className="bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm py-2 px-4 rounded-lg transition cursor-pointer"
              >
                + Agendar TP
              </button>
            </form>

            {tps.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl">
                <p className="text-zinc-400 text-sm">No tenés entregas de TPs agendadas.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tps.map((tp) => {
                  const dias = calcularDiasRestantes(tp.fecha_entrega);
                  const coloresTp: Record<TrabajoPractico['estado'], string> = {
                    pendiente: 'bg-zinc-800 text-zinc-300 border-zinc-700',
                    entregado: 'bg-sky-950 text-sky-300 border-sky-700',
                    aprobado: 'bg-emerald-950 text-emerald-300 border-emerald-700',
                    rehacer: 'bg-red-950 text-red-300 border-red-700',
                  };

                  return (
                    <div
                      key={tp.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-sky-400">
                            {tp.materia_nombre}
                          </span>
                          <span className="text-zinc-600">•</span>
                          <span className="text-xs text-zinc-400">
                            Entrega: {tp.fecha_entrega.split('T')[0].split('-').reverse().join('/')}
                          </span>
                          {tp.nota !== null && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300">
                              Nota: {tp.nota}
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-semibold mt-0.5">{tp.titulo}</h3>
                        {tp.descripcion && (
                          <p className="text-xs text-zinc-400 mt-0.5">{tp.descripcion}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-3">
                        <span className="text-xs text-zinc-400">
                          {dias < 0
                            ? `Venció hace ${Math.abs(dias)}d`
                            : dias === 0
                            ? 'Hoy'
                            : `En ${dias}d`}
                        </span>

                        <select
                          value={tp.estado}
                          onChange={(e) =>
                            actualizarTp(tp, e.target.value as TrabajoPractico['estado'])
                          }
                          className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                            coloresTp[tp.estado]
                          }`}
                        >
                          <option value="pendiente">Pendiente</option>
                          <option value="entregado">Entregado</option>
                          <option value="aprobado">Aprobado</option>
                          <option value="rehacer">Rehacer</option>
                        </select>

                        <button
                          onClick={() => eliminarTp(tp.id)}
                          className="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'calendario' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={() =>
                      setMesActual((prev) =>
                        prev.mes === 0
                          ? { anio: prev.anio - 1, mes: 11 }
                          : { anio: prev.anio, mes: prev.mes - 1 }
                      )
                    }
                    className="bg-zinc-800 hover:bg-zinc-700 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm cursor-pointer"
                  >
                    ←
                  </button>

                  <select
                    value={mesActual.mes}
                    onChange={(e) => {
                      setDiaSeleccionado(null);
                      setMesActual((prev) => ({ ...prev, mes: Number(e.target.value) }));
                    }}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-semibold"
                  >
                    {MESES.map((m, idx) => (
                      <option key={m} value={idx}>
                        {m}
                      </option>
                    ))}
                  </select>

                  <select
                    value={mesActual.anio}
                    onChange={(e) => {
                      setDiaSeleccionado(null);
                      setMesActual((prev) => ({ ...prev, anio: Number(e.target.value) }));
                    }}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-semibold"
                  >
                    {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 1 + i).map(
                      (a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      )
                    )}
                  </select>

                  <button
                    onClick={() =>
                      setMesActual((prev) =>
                        prev.mes === 11
                          ? { anio: prev.anio + 1, mes: 0 }
                          : { anio: prev.anio, mes: prev.mes + 1 }
                      )
                    }
                    className="bg-zinc-800 hover:bg-zinc-700 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm cursor-pointer"
                  >
                    →
                  </button>
                </div>

                <button
                  onClick={() => {
                    const hoy = new Date();
                    setDiaSeleccionado(null);
                    setMesActual({ anio: hoy.getFullYear(), mes: hoy.getMonth() });
                  }}
                  className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-800/60 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Hoy
                </button>
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-zinc-400 border-b border-zinc-800 pb-2">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Examen
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span> TP
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Fin cursada
                </span>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] sm:text-xs font-semibold text-zinc-400">
                {DIAS_SEMANA.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {generarCeldasCalendario().map((dia, idx) => {
                  if (dia === null) {
                    return <div key={`empty-${idx}`} className="h-16 sm:h-24 rounded-xl bg-zinc-950/40" />;
                  }

                  const fechaIso = `${mesActual.anio}-${String(mesActual.mes + 1).padStart(
                    2,
                    '0'
                  )}-${String(dia).padStart(2, '0')}`;

                  const exDia = examenes.filter((ex) => ex.fecha.split('T')[0] === fechaIso);
                  const tpDia = tps.filter((tp) => tp.fecha_entrega.split('T')[0] === fechaIso);

                  const hoyObj = new Date();
                  const esHoy =
                    hoyObj.getFullYear() === mesActual.anio &&
                    hoyObj.getMonth() === mesActual.mes &&
                    hoyObj.getDate() === dia;

                  const seleccionado = diaSeleccionado === fechaIso;
                  const esFin =
                    usuario.fin_cursada && usuario.fin_cursada.split('T')[0] === fechaIso;

                  return (
                    <div
                      key={fechaIso}
                      onClick={() => {
                        setDiaSeleccionado(fechaIso);
                        setExamFecha(fechaIso);
                        setTpFecha(fechaIso);
                      }}
                      className={`min-h-16 sm:min-h-24 rounded-xl p-1 sm:p-1.5 border flex flex-col justify-between transition cursor-pointer ${
                        seleccionado
                          ? 'bg-zinc-800 border-white'
                          : esHoy
                          ? 'bg-blue-950/30 border-blue-500'
                          : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-600'
                      }`}
                    >
                      <span
                        className={`text-[11px] sm:text-xs font-bold ${
                          esHoy ? 'text-blue-400' : 'text-zinc-400'
                        }`}
                      >
                        {dia}
                      </span>

                      <div className="space-y-0.5 sm:space-y-1 mt-1 overflow-y-auto max-h-14">
                        {esFin && (
                          <div className="text-[9px] sm:text-[10px] font-bold bg-emerald-950 text-emerald-300 rounded px-1 truncate">
                            Fin
                          </div>
                        )}
                        {exDia.map((ex) => (
                          <div
                            key={`ex-${ex.id}`}
                            className="text-[9px] sm:text-[10px] bg-amber-950/90 text-amber-200 rounded px-1 truncate"
                          >
                            {ex.materia_nombre}
                          </div>
                        ))}
                        {tpDia.map((tp) => (
                          <div
                            key={`tp-${tp.id}`}
                            className="text-[9px] sm:text-[10px] bg-sky-950/90 text-sky-200 rounded px-1 truncate"
                          >
                            TP: {tp.materia_nombre}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold">
                      {diaSeleccionado
                        ? `Agenda del ${diaSeleccionado.split('-').reverse().join('/')}`
                        : `Agenda de ${MESES[mesActual.mes]}`}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {diaSeleccionado
                        ? 'Eventos y carga rápida'
                        : 'Tocá cualquier día para agendar'}
                    </p>
                  </div>
                  {diaSeleccionado && (
                    <button
                      onClick={() => setDiaSeleccionado(null)}
                      className="text-xs text-blue-400 hover:underline cursor-pointer"
                    >
                      Ver mes
                    </button>
                  )}
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {examenesAgenda.length === 0 && tpsAgenda.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-4 text-center">
                      Sin eventos en esta fecha.
                    </p>
                  ) : (
                    <>
                      {examenesAgenda.map((ex) => (
                        <div
                          key={`ag-ex-${ex.id}`}
                          className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-2.5 text-xs"
                        >
                          <div className="flex justify-between font-semibold text-amber-300">
                            <span>Examen · {ex.materia_nombre}</span>
                            <span>{ex.fecha.split('T')[0].split('-').reverse().join('/')}</span>
                          </div>
                          <p className="text-zinc-200 mt-0.5">{ex.titulo}</p>
                        </div>
                      ))}
                      {tpsAgenda.map((tp) => (
                        <div
                          key={`ag-tp-${tp.id}`}
                          className="bg-sky-950/30 border border-sky-800/50 rounded-lg p-2.5 text-xs"
                        >
                          <div className="flex justify-between font-semibold text-sky-300">
                            <span>TP · {tp.materia_nombre}</span>
                            <span>
                              {tp.fecha_entrega.split('T')[0].split('-').reverse().join('/')}
                            </span>
                          </div>
                          <p className="text-zinc-200 mt-0.5">{tp.titulo}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {diaSeleccionado && (
                <div className="border-t border-zinc-800 pt-4 space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTipoAgendarRapido('examen')}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                        tipoAgendarRapido === 'examen'
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      + Examen
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipoAgendarRapido('tp')}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                        tipoAgendarRapido === 'tp'
                          ? 'bg-sky-600 text-white'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      + Entrega TP
                    </button>
                  </div>

                  {tipoAgendarRapido === 'examen' ? (
                    <form onSubmit={agregarExamen} className="space-y-2">
                      <select
                        value={examMateriaId}
                        onChange={(e) => setExamMateriaId(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs"
                        required
                      >
                        <option value="">Elegir materia...</option>
                        {materias.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nombre}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Ej: 1er Parcial"
                        value={examTitulo}
                        onChange={(e) => setExamTitulo(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs"
                        required
                      />
                      <button
                        type="submit"
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs py-2 rounded-lg cursor-pointer"
                      >
                        Guardar Examen
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={agregarTp} className="space-y-2">
                      <select
                        value={tpMateriaId}
                        onChange={(e) => setTpMateriaId(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs"
                        required
                      >
                        <option value="">Elegir materia...</option>
                        {materias.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nombre}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Ej: Entrega TP Final"
                        value={tpTitulo}
                        onChange={(e) => setTpTitulo(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs"
                        required
                      />
                      <button
                        type="submit"
                        className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 rounded-lg cursor-pointer"
                      >
                        Guardar TP
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'correlativas' && (
          <div className="space-y-6">
            <form
              onSubmit={agregarCorrelativa}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-end"
            >
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Para cursar / rendir...</label>
                <select
                  value={corrMateriaId}
                  onChange={(e) => {
                    setCorrMateriaId(e.target.value);
                    setCorrRequisitoIds((prev) => prev.filter((id) => id !== e.target.value));
                  }}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Elegir materia destino...</option>
                  {materias.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Necesito tener... (podés marcar varias)
                </label>
                <div className="max-h-40 overflow-y-auto bg-zinc-950 border border-zinc-700 rounded-lg p-2 space-y-0.5">
                  {materias.filter((m) => String(m.id) !== corrMateriaId).length === 0 ? (
                    <p className="text-xs text-zinc-500 px-1.5 py-1">Primero cargá materias.</p>
                  ) : (
                    materias
                      .filter((m) => String(m.id) !== corrMateriaId)
                      .map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-900 rounded px-1.5 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={corrRequisitoIds.includes(String(m.id))}
                            onChange={() => alternarRequisito(String(m.id))}
                            className="accent-blue-500"
                          />
                          <span className="truncate">{m.nombre}</span>
                        </label>
                      ))
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Condición exigida</label>
                <select
                  value={corrTipo}
                  onChange={(e) => setCorrTipo(e.target.value as 'regular' | 'aprobada')}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="regular">Regularizada</option>
                  <option value="aprobada">Aprobada (Final)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={!corrMateriaId || corrRequisitoIds.length === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm py-2 px-4 rounded-lg transition cursor-pointer"
              >
                + Vincular{corrRequisitoIds.length > 1 ? ` (${corrRequisitoIds.length})` : ''}
              </button>
            </form>

            {errorCorr && (
              <div className="bg-red-950/60 border border-red-800 text-red-300 text-xs px-3 py-2.5 rounded-lg">
                {errorCorr}
              </div>
            )}

            {correlativas.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl">
                <p className="text-zinc-400 text-sm">Todavía no vinculaste ninguna correlativa.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {correlativasPorMateria.map((g) => {
                  const cumplidas = g.reqs.filter(cumpleRequisito).length;
                  const habilitada = cumplidas === g.reqs.length;

                  return (
                    <div
                      key={g.materia_id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-base font-semibold text-zinc-100">{g.nombre}</h3>
                          <p className="text-xs text-zinc-400">
                            Requiere {g.reqs.length} materia{g.reqs.length === 1 ? '' : 's'}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-lg ${
                            habilitada ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'
                          }`}
                        >
                          {habilitada ? 'Habilitada ✓' : `Faltan ${g.reqs.length - cumplidas}`}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {g.reqs.map((c) => {
                          const ok = cumpleRequisito(c);
                          return (
                            <div
                              key={`${c.materia_id}-${c.correlativa_id}`}
                              className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border ${
                                ok
                                  ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                                  : 'bg-red-950/40 border-red-900/60 text-red-300'
                              }`}
                            >
                              <span>{ok ? '✓' : '•'}</span>
                              <span className="font-medium">{c.correlativa_nombre}</span>
                              <span className="opacity-70">
                                ({c.tipo_requisito === 'aprobada' ? 'aprobada' : 'regular'})
                              </span>
                              <button
                                type="button"
                                onClick={() => eliminarCorrelativa(c.materia_id, c.correlativa_id)}
                                title="Quitar esta correlativa"
                                className="opacity-60 hover:opacity-100 cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}