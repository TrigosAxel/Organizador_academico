// Lee un plan de estudios (Excel, Word, PDF, CSV o texto pegado) y arma una lista de materias.
// Es una lectura "inteligente pero imperfecta": el usuario revisa y corrige todo en una vista previa
// antes de importar. Las librerías pesadas se cargan solo cuando hacen falta, así que si falta
// alguna instalación el resto del servidor sigue funcionando.

const MAX_MATERIAS = 200;

const limpiar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const sinAcentos = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (t) => sinAcentos(limpiar(t)).toLowerCase();

function error(mensaje, codigo = 'ARCHIVO') {
  const e = new Error(mensaje);
  e.codigo = codigo;
  return e;
}

function requerir(paquete, instalar) {
  try {
    return require(paquete);
  } catch (e) {
    throw error(
      `Para leer este tipo de archivo hay que instalar "${instalar}" en el servidor (npm install ${instalar}). Mientras tanto podés pegar el texto del plan.`,
      'FALTA_LIBRERIA'
    );
  }
}

// ---------------------------------------------------------------
// Detección de títulos (año / cuatrimestre) y encabezados de columnas
// ---------------------------------------------------------------
const ANIOS_PALABRA = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6 };
const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

function detectarAnio(texto) {
  const t = norm(texto);
  if (t.length > 40) return null;
  let m = t.match(/^(primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto)\s+ano\b/);
  if (m) return ANIOS_PALABRA[m[1]];
  m = t.match(/^([1-6])\s*(?:°|º|o|er|ro|do|to|ero)?\.?\s*ano\b/);
  if (m) return Number(m[1]);
  m = t.match(/^ano\s*([1-6]|vi|iv|v|iii|ii|i)\b/);
  if (m) return ROMANOS[m[1]] || Number(m[1]);
  return null;
}

function detectarCuatri(texto) {
  const t = norm(texto);
  if (!t) return null;
  if (/\banual\b/.test(t)) return 'Anual';
  if (/\b(2|2do|2°|2º|segundo)\s*(cuatrimestre|semestre)\b/.test(t) || /^(cuatrimestre|semestre)\s*2\b/.test(t)) return '2do';
  if (/\b(1|1er|1ro|1°|1º|primer|primero)\s*(cuatrimestre|semestre)\b/.test(t) || /^(cuatrimestre|semestre)\s*1\b/.test(t)) return '1ro';
  return null;
}

const ENCABEZADOS = {
  nombre: /^(materias?|asignaturas?|espacio curricular|espacios curriculares|unidad curricular|unidades curriculares|nombre|denominacion)$/,
  anio: /^(ano|curso|nivel)$/,
  cuatri: /^(cuatrimestre|periodo|semestre|regimen|cursada|dictado)$/,
  correl: /^(correlativas?|correlatividades?|requisitos?|previas?|correlativas? previas?)$/,
  codigo: /^(codigo|cod\.?|n°|nº|nro\.?|n)$/,
};

function detectarEncabezado(celdas) {
  const mapa = {};
  let aciertos = 0;
  celdas.forEach((celda, i) => {
    const t = norm(celda);
    if (!t) return;
    for (const [clave, regex] of Object.entries(ENCABEZADOS)) {
      if (mapa[clave] === undefined && regex.test(t)) {
        mapa[clave] = i;
        aciertos++;
        break;
      }
    }
  });
  return aciertos >= 2 && mapa.nombre !== undefined ? mapa : null;
}

const RUIDO = [
  /^(p[aá]gina|pag\.?|hoja)\s*\d+/i,
  /^\d+\s*(de\s*\d+)?$/,
  /^(plan de estudios?|carga horaria|total(es)?|asignaturas?|materias?|correlativas?|condiciones?|referencias?|observaciones?|resoluci[oó]n|ordenanza)\b.{0,40}$/i,
];
const TITULO_DOCUMENTO = /^(universidad|facultad|carrera|licenciatura en|tecnicatura|ingenier[ií]a en|profesorado)\b/i;

function esRuido(linea, anioActual) {
  if (linea.length > 120) return true;
  if (RUIDO.some((r) => r.test(linea))) return true;
  if (anioActual === null && TITULO_DOCUMENTO.test(linea)) return true;
  return false;
}

// ---------------------------------------------------------------
// Interpretación de una materia
// ---------------------------------------------------------------
function parsearCorrelativas(texto) {
  const t = limpiar(texto);
  if (!t) return [];
  if (/^(ninguna|no tiene|sin correlativas?|-+|—+|n\/a)$/i.test(t)) return [];
  return t
    .split(/[,;/]|\s+y\s+|\s+e\s+/i)
    .map((x) => limpiar(x).replace(/^[\s\-–•*]+|[\s.]+$/g, ''))
    .filter((x) => x && !/^(ninguna|no tiene|sin correlativas?)$/i.test(x));
}

function limpiarNombre(t) {
  return limpiar(t)
    .replace(/^[\s•·\-–—*]+/, '')
    .replace(/[\s.:;,\-–]+$/, '')
    .slice(0, 120);
}

const tieneLetras = (t) => (String(t).match(/[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/g) || []).length >= 3;

// Una línea de texto corrido, por ejemplo: "12 - Programación II (96 hs) 1er cuatrimestre Correlativas: 5, 7"
function parsearLineaSimple(texto) {
  let t = limpiar(texto).replace(/^[\s•·\-–—*]+/, '');
  let cuatri = null;
  let codigo = null;
  let correlativas = [];

  const mc = t.match(/\b(?:1|2|1er|1ro|2do|primer|segundo)\s*[°º]?\s*(?:cuatrimestre|semestre)\b|\banual\b/i);
  if (mc) {
    cuatri = detectarCuatri(mc[0]);
    t = limpiar(t.replace(mc[0], ' '));
  }

  const mr = t.match(/\b(?:correlativas?|correlatividades?|correl\.?|requisitos?|req\.?)\s*[:\-]?\s*(.*)$/i);
  if (mr) {
    correlativas = parsearCorrelativas(mr[1]);
    t = limpiar(t.slice(0, mr.index));
  }

  const mcod = t.match(/^((?:[A-Za-z]{1,4}[-\s]?)?\d{1,4})\s*[-–.):]?\s+(.*[A-Za-zÁÉÍÓÚáéíóúÑñ].*)$/);
  if (mcod) {
    codigo = mcod[1].replace(/\s+/g, '');
    t = mcod[2];
  }

  t = t.replace(/\s*[-–|(]?\s*\d{1,3}\s*(?:hs?\.?|horas?)\)?\s*$/i, '');
  const nombre = limpiarNombre(t);
  if (!tieneLetras(nombre)) return null;
  return { nombre, codigo, cuatrimestre: cuatri, anio: null, correlativas };
}

// Una fila con varias celdas, sin encabezado que diga qué es cada columna
function parsearFilaHeuristica(celdas) {
  const llenas = celdas.map(limpiar).filter(Boolean);
  if (llenas.length === 0) return null;
  if (llenas.length === 1) return parsearLineaSimple(llenas[0]);

  let codigo = null;
  let nombre = null;
  let anio = null;
  let cuatri = null;
  const resto = [];

  for (const c of llenas) {
    if (/^[A-Za-z]{0,4}[-\s]?\d{1,4}$/.test(c) && nombre === null && codigo === null) {
      codigo = c.replace(/\s+/g, '');
      continue;
    }
    if (nombre === null && tieneLetras(c) && !detectarCuatri(c)) {
      nombre = c;
      continue;
    }
    const cu = detectarCuatri(c);
    if (cu && cuatri === null) {
      cuatri = cu;
      continue;
    }
    if (/^[1-6]\s*[°º]?$/.test(c) && anio === null) {
      anio = Number(c[0]);
      continue;
    }
    if (tieneLetras(c) || /\d/.test(c)) resto.push(c);
  }
  if (!nombre) return null;
  const mini = parsearLineaSimple(nombre);
  const correlativas = parsearCorrelativas(resto.filter((x) => tieneLetras(x) || /[,;]/.test(x)).join(', '));
  return {
    nombre: mini ? mini.nombre : limpiarNombre(nombre),
    codigo: codigo || (mini && mini.codigo) || null,
    cuatrimestre: cuatri || (mini && mini.cuatrimestre) || null,
    anio,
    correlativas,
  };
}

function parsearFilaConMapa(celdas, mapa) {
  const get = (i) => (i === undefined ? '' : limpiar(celdas[i]));
  const nombreCrudo = get(mapa.nombre);
  if (!tieneLetras(nombreCrudo)) return null;
  const mini = parsearLineaSimple(nombreCrudo);
  const anioTxt = get(mapa.anio);
  let anio = null;
  if (anioTxt) {
    const num = anioTxt.match(/[1-6]/);
    anio = num ? Number(num[0]) : detectarAnio(`${anioTxt} año`);
  }
  const cuatriTxt = get(mapa.cuatri);
  return {
    nombre: mini ? mini.nombre : limpiarNombre(nombreCrudo),
    codigo: get(mapa.codigo) || (mini && mini.codigo) || null,
    cuatrimestre: detectarCuatri(cuatriTxt) || (/^1$/.test(cuatriTxt) ? '1ro' : /^2$/.test(cuatriTxt) ? '2do' : null) || (mini && mini.cuatrimestre) || null,
    anio,
    correlativas: parsearCorrelativas(get(mapa.correl)),
  };
}

// ---------------------------------------------------------------
// Núcleo: recorre las filas y arma la lista de materias
// items: [{ celdas: [..] }]
// ---------------------------------------------------------------
function interpretarItems(items) {
  const resultado = [];
  let anio = null;
  let cuatri = null;
  let mapa = null;

  for (const item of items) {
    const celdas = item.celdas.map((c) => limpiar(c));
    const llenas = celdas.filter(Boolean);
    if (llenas.length === 0) continue;
    const linea = llenas.join(' ');

    const encabezado = detectarEncabezado(celdas);
    if (encabezado) {
      mapa = encabezado;
      continue;
    }

    if (llenas.length === 1) {
      const a = detectarAnio(llenas[0]);
      if (a) {
        anio = a;
        cuatri = null;
        continue;
      }
      const c = detectarCuatri(llenas[0]);
      if (c && llenas[0].length < 40) {
        cuatri = c;
        continue;
      }
    }

    if (esRuido(linea, anio)) continue;

    const fila = mapa && celdas.length > 1 ? parsearFilaConMapa(celdas, mapa) : parsearFilaHeuristica(celdas);
    if (!fila || !fila.nombre) continue;

    resultado.push({
      nombre: fila.nombre,
      codigo: fila.codigo || null,
      anio: fila.anio || anio || 1,
      cuatrimestre: fila.cuatrimestre || cuatri || '1ro',
      correlativas: fila.correlativas || [],
    });
  }

  // sin repetidos
  const vistos = new Set();
  return resultado
    .filter((m) => {
      const k = norm(m.nombre);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .slice(0, MAX_MATERIAS);
}

// ---------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------
function itemsDesdeTexto(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map((linea) => ({ celdas: linea.split(/\t|\s*\|\s*/) }));
}

function parsearCSV(texto) {
  const primeras = texto.split(/\r?\n/).slice(0, 10).join('\n');
  const cuenta = (c) => (primeras.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) || []).length;
  const delimitador = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === delimitador) {
      fila.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.map((celdas) => ({ celdas }));
}

function textoCelda(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(v);
}

async function itemsDesdeExcel(buffer) {
  const ExcelJS = requerir('exceljs', 'exceljs');
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer);
  } catch (e) {
    throw error('No pude abrir ese Excel. Guardalo como .xlsx (no .xls) y probá de nuevo.');
  }
  const items = [];
  libro.worksheets.forEach((hoja) => {
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      const celdas = [];
      fila.eachCell({ includeEmpty: true }, (celda, col) => {
        celdas[col - 1] = textoCelda(celda.value);
      });
      items.push({ celdas: Array.from(celdas, (c) => c || '') });
    });
  });
  return items;
}

const decodificarHtml = (t) =>
  t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const sinEtiquetas = (h) => decodificarHtml(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));

async function itemsDesdeWord(buffer) {
  const mammoth = requerir('mammoth', 'mammoth');
  let html;
  try {
    html = (await mammoth.convertToHtml({ buffer })).value;
  } catch (e) {
    throw error('No pude abrir ese Word. Guardalo como .docx y probá de nuevo.');
  }
  // Recorre el documento en orden: los párrafos son títulos o líneas, las filas de tablas son celdas
  const items = [];
  const bloques = html.match(/<tr[\s\S]*?<\/tr>|<(?:p|h[1-6]|li)[^>]*>[\s\S]*?<\/(?:p|h[1-6]|li)>/gi) || [];
  for (const b of bloques) {
    if (/^<tr/i.test(b)) {
      const celdas = (b.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => limpiar(sinEtiquetas(c)));
      items.push({ celdas });
    } else {
      items.push({ celdas: [limpiar(sinEtiquetas(b))] });
    }
  }
  return items;
}

async function itemsDesdePdf(buffer) {
  const pdfParse = requerir('pdf-parse', 'pdf-parse@1.1.1');
  let datos;
  try {
    datos = await pdfParse(buffer);
  } catch (e) {
    throw error('No pude leer ese PDF. Si es un escaneo (una foto), copiá el texto a mano y pegalo.');
  }
  const texto = String(datos.text || '');
  if (texto.replace(/\s/g, '').length < 20) {
    throw error('Ese PDF no tiene texto seleccionable (parece un escaneo). Pegá el texto del plan a mano.');
  }
  return itemsDesdeTexto(texto);
}

async function analizarArchivo(nombreArchivo, buffer) {
  const ext = (String(nombreArchivo).split('.').pop() || '').toLowerCase();
  const esZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  const esPdf = buffer.slice(0, 5).toString() === '%PDF-';

  let items;
  if (ext === 'pdf' || esPdf) items = await itemsDesdePdf(buffer);
  else if (ext === 'docx') items = await itemsDesdeWord(buffer);
  else if (ext === 'xlsx' || ext === 'xlsm') items = await itemsDesdeExcel(buffer);
  else if (ext === 'csv' || ext === 'tsv') items = parsearCSV(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  else if (ext === 'txt' || ext === 'md') items = itemsDesdeTexto(buffer.toString('utf8'));
  else if (ext === 'doc' || ext === 'xls')
    throw error(`Los archivos .${ext} viejos no se pueden leer. Abrilo y guardalo como .${ext}x (o como PDF) y probá de nuevo.`);
  else if (esZip) items = await itemsDesdeExcel(buffer);
  else throw error('Formato no soportado. Subí un Excel (.xlsx), Word (.docx), PDF, CSV o TXT.');

  return interpretarItems(items);
}

function interpretarTexto(texto) {
  return interpretarItems(itemsDesdeTexto(texto));
}

module.exports = { analizarArchivo, interpretarTexto, interpretarItems, norm, parsearCSV, _interno: { detectarAnio, detectarCuatri, parsearLineaSimple } };