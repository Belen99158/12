/* ============================================================================
   CONECTOR PERSEO  ->  BASE DE FACTURAS DEL SISTEMA DE DEVOLUCIONES
   ============================================================================

   PARA QUE SIRVE
   Hoy la base de facturas se exporta y se sube a mano. Este programa la trae
   sola desde Perseo y la deja lista en Firebase, con el MISMO formato que usa
   hoy el sistema. La pagina no cambia en nada: sigue leyendo la base de
   Firebase igual que siempre, solo que ya nadie tiene que subirla.

   POR QUE ES UN PROGRAMA APARTE Y NO ESTA DENTRO DE LA PAGINA
   Dos razones, las dos importantes:

   1. Perseo corre en un servidor DENTRO de la oficina. Una pagina publicada en
      internet (Vercel) no puede alcanzarlo, y abrir ese servidor a internet
      para lograrlo seria muy peligroso: es el servidor contable. Este programa
      corre DENTRO de la red de la oficina, donde si lo alcanza, y solo manda
      datos HACIA AFUERA (a Firebase). No hay que abrir ningun puerto.

   2. La clave de Perseo (api_key) va en cada pedido. Si la pagina la llamara
      directo, esa clave quedaria a la vista en el codigo de la pagina y
      cualquiera podria leer facturas, clientes y costos. Aqui la clave se
      queda en el archivo config.json, en la maquina de la oficina.

   COMO SE USA  (tres pasos, de menos a mas compromiso)

     node conector.js probar
         Solo saluda a Perseo y muestra que devuelve. NO escribe nada en
         ningun lado. Es lo primero que hay que correr.

     node conector.js ver
         Trae las facturas, las traduce al formato del sistema y muestra un
         resumen y unas filas de ejemplo. Tampoco escribe nada.

     node conector.js subir
         Lo mismo que "ver", pero ademas sube la base a Firebase, a la ruta
         que diga config.json (de fabrica: una ruta de PRUEBAS aparte).

   No necesita instalar nada: usa solo lo que trae Node.
   ============================================================================ */

"use strict";
const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");

const RUTA_REAL = "baseFacturas"; /* la que usa el sistema de verdad */

/* ---------------------------------------------------------------- config -- */
function leerConfig(){
  const p = path.join(__dirname, "config.json");
  if(!fs.existsSync(p)){
    salir("No encuentro config.json.\n" +
          "Copia config.ejemplo.json como config.json y llena los datos.\n" +
          "Deberia quedar en: " + p);
  }
  let c;
  try{ c = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch(e){ salir("config.json tiene un error de formato: " + e.message); }

  const falta = [];
  if(!c.perseo || !c.perseo.url)      falta.push("perseo.url");
  if(!c.perseo || !c.perseo.api_key)  falta.push("perseo.api_key");
  if(!c.firebase || !c.firebase.usuario)  falta.push("firebase.usuario");
  if(!c.firebase || !c.firebase.password) falta.push("firebase.password");
  if(falta.length) salir("Faltan datos en config.json: " + falta.join(", "));

  if(/PEGA_AQUI/i.test(c.perseo.api_key + c.firebase.password)){
    salir("config.json todavia tiene los textos de ejemplo (PEGA_AQUI...).\n" +
          "Reemplazalos por los datos de verdad.");
  }
  return c;
}

function salir(msg){ console.error("\n*** " + msg + "\n"); process.exit(1); }

/* ------------------------------------------------------------ red basica -- */
/* Un POST de JSON, devolviendo el JSON de respuesta. Se usa tanto para Perseo
   como para Firebase, asi no hay que instalar librerias. */
function postJSON(url, cuerpo, opciones){
  opciones = opciones || {};
  return new Promise(function(resolve, reject){
    let u;
    try{ u = new URL(url); }catch(e){ return reject(new Error("URL invalida: " + url)); }
    const datos = Buffer.from(JSON.stringify(cuerpo), "utf8");
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "http:" ? 80 : 443),
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": datos.length },
      /* Perseo PC en la oficina suele tener un certificado propio (no comprado),
         y Node lo rechazaria. Como es una direccion de la red interna que ustedes
         controlan, se permite, pero SOLO si config.json lo pide expresamente. */
      rejectUnauthorized: opciones.permitirCertificadoPropio ? false : true,
      timeout: opciones.timeout || 120000
    }, function(res){
      let txt = "";
      res.setEncoding("utf8");
      res.on("data", function(d){ txt += d; });
      res.on("end", function(){
        if(res.statusCode < 200 || res.statusCode >= 300){
          return reject(new Error("El servidor respondio " + res.statusCode + ": " + txt.slice(0, 500)));
        }
        try{ resolve(JSON.parse(txt)); }
        catch(e){ reject(new Error("La respuesta no es JSON valido. Empieza asi:\n" + txt.slice(0, 500))); }
      });
    });
    req.on("timeout", function(){ req.destroy(new Error("El servidor no respondio a tiempo.")); });
    req.on("error", reject);
    req.write(datos);
    req.end();
  });
}

/* ---------------------------------------------------------------- Perseo -- */

/* LO UNICO QUE ESTE PROGRAMA TIENE PERMITIDO PEDIRLE A PERSEO.
   Los cinco son de SOLO LECTURA: consultan y devuelven datos. Ninguno crea,
   modifica ni borra nada en Perseo.

   Esto importa porque la api_key de Perseo es la misma para el servidor de
   pruebas y para el real, asi que la clave sola no protege nada. Este candado
   si: aunque alguien apunte este programa al Perseo de verdad, lo unico que
   puede hacer ahi es LEER. Para que pudiera escribir algo habria que venir a
   esta lista y cambiarla a proposito.

   Lo que queda fuera, y seguira quedando fuera: facturas_crear (que con el
   codigo "04" genera una nota de credito REAL ante el SRI), y todo lo que
   termine o empiece en crear / editar / actualizar / eliminar / autorizar. */
const ENDPOINTS_PERMITIDOS = [
  "facturas_consulta",        /* facturas y notas de credito */
  "consultar_clientes",       /* razon social y RUC */
  "consulta_producto",        /* codigos y descripciones */
  "facturadores_consulta",    /* vendedores y asesores */
  "almacenes_consulta"        /* bodegas */
];

const PALABRAS_QUE_ESCRIBEN = /(^|_)(crear|editar|actualizar|eliminar|autorizar|aprobar|borrar)(_|$)/i;

function revisarEndpoint(endpoint){
  const e = String(endpoint || "").toLowerCase();
  if(PALABRAS_QUE_ESCRIBEN.test(e)){
    throw new Error("BLOQUEADO: \"" + endpoint + "\" es un endpoint que ESCRIBE en Perseo.\n" +
                    "  Este conector es de solo lectura y no puede llamarlo.");
  }
  if(ENDPOINTS_PERMITIDOS.indexOf(e) < 0){
    throw new Error("BLOQUEADO: \"" + endpoint + "\" no esta en la lista de endpoints permitidos.\n" +
                    "  Permitidos (todos de solo lectura): " + ENDPOINTS_PERMITIDOS.join(", "));
  }
}

function pedirAPerseo(cfg, endpoint, cuerpo){
  revisarEndpoint(endpoint);
  const base = String(cfg.perseo.url).replace(/\/+$/, "");
  const url  = base + "/api/" + endpoint;
  const body = Object.assign({ api_key: cfg.perseo.api_key }, cuerpo || {});
  return postJSON(url, body, {
    permitirCertificadoPropio: !!cfg.perseo.aceptarCertificadoLocal,
    timeout: (cfg.perseo.timeoutSegundos || 180) * 1000
  });
}

/* ------------------------------------------------------- utilidades datos -- */
function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function txt(v){ return v == null ? "" : String(v).trim(); }

/* Busca el primer campo que exista, probando varios nombres posibles.
   Perseo puede devolver los nombres con pequenas diferencias segun la version,
   asi que en vez de adivinar uno solo, se prueban los razonables. */
function campo(obj, nombres, porDefecto){
  if(!obj) return porDefecto;
  for(const n of nombres){
    if(obj[n] !== undefined && obj[n] !== null && obj[n] !== "") return obj[n];
  }
  return porDefecto;
}

/* "002" + "001" + "000092497"  ->  "002-001-000092497", como lo escribe el sistema */
function armarNumeroFactura(f){
  const est = txt(campo(f, ["establecimiento"], "")).padStart(3, "0");
  const pto = txt(campo(f, ["puntoemision", "puntoemison"], "")).padStart(3, "0");
  const sec = txt(campo(f, ["secuencial", "secuencia", "facturas_secuencia"], "")).padStart(9, "0");
  if(!est && !pto && !sec) return "";
  return est + "-" + pto + "-" + sec;
}

function soloFecha(v){
  const s = txt(v);
  if(!s) return "";
  /* viene como 2026-07-09, 2026-07-09T00:00:00, 09/07/2026 o 20260709 */
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);        if(m) return m[1]+"-"+m[2]+"-"+m[3];
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);          if(m) return m[3]+"-"+m[2]+"-"+m[1];
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);              if(m) return m[1]+"-"+m[2]+"-"+m[3];
  return s;
}
function mesDe(fecha){ const f = soloFecha(fecha); return /^\d{4}-\d{2}/.test(f) ? f.slice(0, 7) : ""; }

/* ------------------------------------------------------------- traduccion -- */
/* Convierte lo que devuelve Perseo al formato de fila que ya usa el sistema:
   emision, factura, ruc, razon, codigo, desc, sub, facturador,
   cant, neto, iva, total, creditoAplicado, totalDoc, mes
   Una fila por cada producto de cada factura. */
function traducir(respuesta){
  const docs  = sacarListaDeFacturas(respuesta);
  const filas = [];
  const notasCredito = [];
  let sinDetalle = 0;

  for(const d of docs){
    const cab = d.facturas || d.factura || d.cabecera || d;
    const detalles = campo(d, ["detalles", "detalle", "items"], campo(cab, ["detalles", "detalle"], [])) || [];
    const tipo = txt(campo(cab, ["sri_documentoscodigo", "tipodocumento", "documentocodigo"], "01"));

    const numero = armarNumeroFactura(cab);
    const emision = soloFecha(campo(cab, ["emision", "fechaemision", "fecha"], ""));
    const ruc   = txt(campo(cab, ["identificacion", "clienteidentificacion", "ruc"], campo(d, ["identificacion"], "")));
    const razon = txt(campo(cab, ["razonsocial", "clienterazonsocial", "cliente"], campo(d, ["razonsocial"], ""))).toUpperCase();
    const facturador = txt(campo(cab, ["vendedor", "vendedornombre", "facturador", "facturadornombre"], "")).toUpperCase();
    const totalDoc = num(campo(cab, ["total", "totalfactura"], 0));

    /* Las notas de credito ("04") no son ventas: son devoluciones ya hechas.
       Se guardan aparte para descontarlas de la factura original, igual que
       hace hoy el sistema con la columna "credito aplicado". */
    if(tipo === "04"){
      notasCredito.push({
        relacionada: armarNumeroFactura({
          establecimiento: campo(cab, ["relacionestablecimiento"], ""),
          puntoemision:    campo(cab, ["relacionpuentoemision", "relacionpuntoemision"], ""),
          secuencial:      campo(cab, ["relacionsecuencia"], "")
        }),
        total: Math.abs(totalDoc),
        detalles: detalles
      });
      continue;
    }

    if(!Array.isArray(detalles) || detalles.length === 0){ sinDetalle++; continue; }

    for(const it of detalles){
      const cant  = num(campo(it, ["cantidad", "cantidaddigitada"], 0));
      if(cant <= 0) continue;
      const precio = num(campo(it, ["precio"], 0));
      const desc   = num(campo(it, ["descuentovalor"], 0));
      const pIva   = num(campo(it, ["iva"], 0));          /* porcentaje */
      const neto   = +(cant * precio - desc).toFixed(4);
      const iva    = +(neto * pIva / 100).toFixed(4);

      filas.push({
        emision: emision,
        factura: numero,
        ruc: ruc,
        razon: razon,
        codigo: txt(campo(it, ["productocodigo", "codigo", "codigoproducto"], "")),
        desc:   txt(campo(it, ["descripcion", "informaciondetalle", "producto", "informacion"], "")),
        sub:    txt(campo(it, ["linea", "categoria", "marca", "productos_lineas"], "")),
        facturador: facturador,
        cant: cant,
        neto: neto,
        iva: iva,
        total: +(neto + iva).toFixed(4),
        creditoAplicado: 0,
        totalDoc: totalDoc,
        mes: mesDe(emision)
      });
    }
  }

  /* Reparte el monto de cada nota de credito sobre las filas de su factura */
  let ncAplicadas = 0, ncSinFactura = 0;
  for(const nc of notasCredito){
    if(!nc.relacionada){ ncSinFactura++; continue; }
    const suyas = filas.filter(f => f.factura === nc.relacionada);
    if(!suyas.length){ ncSinFactura++; continue; }
    const suma = suyas.reduce((s, f) => s + f.total, 0);
    if(suma > 0) suyas.forEach(f => { f.creditoAplicado += +(nc.total * f.total / suma).toFixed(4); });
    ncAplicadas++;
  }

  return { filas, ncAplicadas, ncSinFactura, documentos: docs.length, sinDetalle };
}

/* La respuesta puede venir como un arreglo suelto, o envuelta en facturas/data/
   registro/registros. Se busca el primer arreglo que parezca la lista. */
function sacarListaDeFacturas(r){
  if(Array.isArray(r)) return r;
  if(!r || typeof r !== "object") return [];
  for(const k of ["facturas", "data", "registro", "registros", "resultado", "result", "rows"]){
    if(Array.isArray(r[k])) return r[k];
  }
  for(const k of Object.keys(r)) if(Array.isArray(r[k]) && r[k].length && typeof r[k][0] === "object") return r[k];
  return [];
}

/* ------------------------------------------- mismo empaquetado que la web -- */
/* COPIA EXACTA de comprimirBase() de index.html (version 3). Si algun dia
   cambia alla, hay que cambiarla aqui igual, o el sistema leera mal la base. */
function comprimirBase(rows){
  var pool=[], map={};
  function idx(s){ s=String(s==null?"":s); if(map[s]!==undefined) return map[s]; var i=pool.length; pool.push(s); map[s]=i; return i; }
  var r=rows.map(function(x){ return [idx(x.emision),idx(x.factura),idx(x.ruc),idx(x.razon),idx(x.codigo),idx(x.desc),idx(x.sub),idx(x.facturador),x.cant,x.neto,x.iva,x.total,x.creditoAplicado||0,x.totalDoc||0,idx(x.mes)]; });
  return {v:3,p:pool,r:r};
}

/* -------------------------------------------------------------- Firebase -- */
async function entrarAFirebase(cfg){
  const r = await postJSON(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + cfg.firebase.apiKey,
    { email: cfg.firebase.usuario, password: cfg.firebase.password, returnSecureToken: true });
  if(!r.idToken) throw new Error("Firebase no devolvio la sesion.");
  return r.idToken;
}

function escribirEnFirebase(cfg, token, ruta, valor){
  return new Promise(function(resolve, reject){
    const u = new URL(cfg.firebase.databaseURL.replace(/\/+$/, "") + "/" + ruta + ".json");
    u.searchParams.set("auth", token);
    const datos = Buffer.from(JSON.stringify(valor), "utf8");
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": datos.length }
    }, function(res){
      let t = ""; res.on("data", d => t += d);
      res.on("end", function(){
        if(res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error("Firebase respondio " + res.statusCode + ": " + t.slice(0, 300)));
      });
    });
    req.on("error", reject);
    req.write(datos); req.end();
  });
}

const TROZO = 200000; /* mismo tamano de bloque que usa la pagina */

/* CANDADO: este conector esta hecho para probar. Para escribir sobre la base de
   verdad hay que decirlo a proposito en la linea de comandos. Se revisa ANTES de
   pedir nada a Perseo, para avisar de una vez y no despues de varios minutos. */
function revisarCandado(cfg, orden){
  if(orden !== "subir") return;
  const ruta = txt(cfg.firebase.ruta) || "baseFacturasPruebas";
  if(ruta === RUTA_REAL && !process.argv.includes("--si-es-la-real")){
    salir("config.json apunta a la base REAL (\"" + RUTA_REAL + "\").\n" +
          "Eso reemplazaria la base que esta usando la gente ahora mismo.\n" +
          "No se pidio nada a Perseo ni se escribio nada.\n\n" +
          "Si de verdad es lo que quieres, corre:  node conector.js subir --si-es-la-real");
  }
}

async function subirBase(cfg, filas){
  const ruta = txt(cfg.firebase.ruta) || "baseFacturasPruebas";
  const json = JSON.stringify(comprimirBase(filas));
  const trozos = [];
  for(let i = 0; i < json.length; i += TROZO) trozos.push(json.slice(i, i + TROZO));

  console.log("  Entrando a Firebase como " + cfg.firebase.usuario + " ...");
  const token = await entrarAFirebase(cfg);

  console.log("  Subiendo a \"" + ruta + "\" (" + trozos.length + " bloques, " +
              (json.length / 1048576).toFixed(2) + " MB) ...");
  for(let i = 0; i < trozos.length; i++){
    await escribirEnFirebase(cfg, token, ruta + "/chunks/" + i, trozos[i]);
    process.stdout.write("\r  bloque " + (i + 1) + " de " + trozos.length + "   ");
  }
  console.log("");
  await escribirEnFirebase(cfg, token, ruta + "/meta", {
    chunks: trozos.length,
    filas: filas.length,
    fecha: new Date().toISOString(),
    origen: "conector-perseo"
  });
  console.log("  Listo. Base subida a \"" + ruta + "\".");
}

/* -------------------------------------------------------------- informes -- */
function resumen(res){
  const f = res.filas;
  console.log("\n  RESUMEN DE LO QUE SE TRAJO");
  console.log("  --------------------------------------------------");
  console.log("  Documentos leidos de Perseo : " + res.documentos);
  console.log("  Filas (producto x factura)  : " + f.length);
  console.log("  Notas de credito aplicadas  : " + res.ncAplicadas);
  if(res.ncSinFactura) console.log("  Notas de credito sin factura: " + res.ncSinFactura + "   <-- revisar");
  if(res.sinDetalle)   console.log("  Facturas sin detalle        : " + res.sinDetalle + "   <-- revisar");

  if(!f.length){ console.log("\n  No salio ninguna fila. Corre \"probar\" y revisa la muestra.\n"); return; }

  const facturas = new Set(f.map(x => x.factura));
  const clientes = new Set(f.map(x => x.ruc));
  const fechas = f.map(x => x.emision).filter(Boolean).sort();
  console.log("  Facturas distintas          : " + facturas.size);
  console.log("  Clientes distintos          : " + clientes.size);
  console.log("  Desde / hasta               : " + (fechas[0] || "?") + "  ->  " + (fechas[fechas.length - 1] || "?"));

  /* Campos vacios: avisa en vez de subir una base muda */
  const claves = ["emision","factura","ruc","razon","codigo","desc","facturador","cant","total"];
  const vacios = claves.map(k => ({ k, n: f.filter(x => x[k] === "" || x[k] === 0 || x[k] == null).length }))
                       .filter(x => x.n > f.length * 0.1);
  if(vacios.length){
    console.log("\n  OJO - campos que vienen vacios en mas del 10% de las filas:");
    vacios.forEach(v => console.log("    " + v.k.padEnd(12) + " vacio en " + v.n + " de " + f.length));
    console.log("  (significa que el nombre del campo en Perseo es otro: hay que ajustar la traduccion)");
  }

  console.log("\n  TRES FILAS DE EJEMPLO");
  console.log("  --------------------------------------------------");
  f.slice(0, 3).forEach(function(x){
    console.log("   " + x.emision + "  " + x.factura + "  " + x.ruc);
    console.log("     " + x.razon.slice(0, 60));
    console.log("     " + x.codigo + "  x" + x.cant + "  total " + x.total.toFixed(2) + "  (" + x.desc.slice(0, 45) + ")");
  });
  console.log("");
}

/* --------------------------------------------------- encontrar el servidor -- */
/* Ayuda a dar con la direccion de Perseo cuando no se sabe el puerto.
   Prueba los puertos mas habituales en la IP que se le indique y dice en cual
   hay algo escuchando. NO manda la api_key de verdad: usa una falsa, porque
   solo necesita saber si alguien contesta, no entrar. */
const PUERTOS_HABITUALES = [443, 8443, 8080, 8081, 9000, 9443, 3000, 5000, 80];

async function buscarDireccion(ip){
  ip = String(ip || "").trim().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  if(!ip){
    console.log("\n  Uso:  node conector.js direccion 192.168.1.50\n" +
                "  (la IP de la maquina donde esta instalado Perseo)\n");
    process.exit(1);
  }

  console.log("\n  Buscando Perseo en " + ip + " ...");
  console.log("  (se prueba con una clave falsa: lo unico que interesa es si alguien contesta)\n");

  const encontrados = [];
  for(const puerto of PUERTOS_HABITUALES){
    for(const esquema of ["https", "http"]){
      /* el puerto por defecto no se escribe, como dice la documentacion para el caso local */
      const omitir = (esquema === "https" && puerto === 443) || (esquema === "http" && puerto === 80);
      const url = esquema + "://" + ip + (omitir ? "" : ":" + puerto);
      let estado = "";
      try{
        await postJSON(url + "/api/facturas_consulta", { api_key: "PRUEBA-DE-CONEXION", dias: 1 },
                       { permitirCertificadoPropio: true, timeout: 4000 });
        estado = "contesta y acepta"; /* raro, pero es una respuesta */
      }catch(e){
        const m = e.message || "";
        if(/respondio (\d+)/.test(m))            estado = "CONTESTA (" + m.match(/respondio (\d+)/)[1] + ")";
        else if(/no es JSON valido/.test(m))     estado = "CONTESTA (pero no es la API)";
        else if(/ECONNREFUSED/.test(m))          estado = "";   /* nada escuchando */
        else if(/tiempo|ETIMEDOUT|EHOSTUNREACH/.test(m)) estado = "";
        else if(/certificate|SSL|EPROTO/i.test(m)) estado = "CONTESTA (problema de certificado)";
        else estado = "";
      }
      if(estado){
        console.log("   " + estado.padEnd(34) + url);
        encontrados.push({ url, estado });
      }
    }
  }

  console.log("");
  if(!encontrados.length){
    console.log("  No contesto nada en esa IP.\n\n" +
                "  Puede ser que:\n" +
                "   - esta maquina no este en la misma red que el servidor\n" +
                "   - la IP no sea esa (revisa el paso 1 y 2 del LEEME)\n" +
                "   - Perseo use un puerto fuera de los habituales: preguntaselo al proveedor\n");
  }else{
    const api = encontrados.filter(e => /^CONTESTA \(\d/.test(e.estado));
    console.log("  La buena senal es un CONTESTA con numero: ahi hay un servidor que");
    console.log("  entiende el pedido y lo rechazo por la clave falsa, que es lo esperado.\n");
    if(api.length) console.log("  Lo mas probable es:  " + api[0].url + "\n");
    console.log("  Pon esa direccion en config.json y corre:  node conector.js probar\n");
  }
}

/* ------------------------------------------------------------------ main -- */
async function main(){
  const orden = (process.argv[2] || "").toLowerCase();

  if(orden === "direccion"){ await buscarDireccion(process.argv[3]); return; }

  if(["probar", "ver", "subir"].indexOf(orden) < 0){
    console.log("\n  CONECTOR PERSEO -> BASE DE FACTURAS\n" +
                "  ----------------------------------------------------\n" +
                "    node conector.js direccion <IP>   busca en que puerto responde Perseo\n" +
                "    node conector.js probar           solo mira que responde Perseo (no escribe nada)\n" +
                "    node conector.js ver              trae y traduce, muestra resumen (no escribe nada)\n" +
                "    node conector.js subir            ademas sube la base a Firebase\n");
    process.exit(1);
  }

  const cfg = leerConfig();
  revisarCandado(cfg, orden);
  const dias = orden === "probar" ? (cfg.perseo.diasPrueba || 7) : (cfg.perseo.dias || 400);

  console.log("\n  Perseo : " + cfg.perseo.url + "   (ultimos " + dias + " dias)");
  console.log("  Pidiendo facturas ...");

  let r;
  try{
    r = await pedirAPerseo(cfg, "facturas_consulta", { dias: dias, generarpdf: false, control: false });
  }catch(e){
    /* Un bloqueo del candado no es un problema de red: se muestra tal cual. */
    if(/^BLOQUEADO/.test(e.message)) salir(e.message);
    salir("No se pudo hablar con Perseo:\n  " + e.message + "\n\n" +
          "  Revisa que:\n" +
          "   - esta maquina este en la red de la oficina\n" +
          "   - la direccion de config.json sea la correcta (con su puerto)\n" +
          "   - la api_key sea valida y este activa\n" +
          "   - si el certificado es propio, aceptarCertificadoLocal este en true");
  }

  if(orden === "probar"){
    const lista = sacarListaDeFacturas(r);
    const salida = path.join(__dirname, "muestra-perseo.json");
    fs.writeFileSync(salida, JSON.stringify(lista.slice(0, 3), null, 2), "utf8");

    console.log("\n  CONEXION CORRECTA\n");
    console.log("  Documentos que devolvio : " + lista.length);
    if(lista.length){
      const d = lista[0];
      const cab = d.facturas || d.factura || d.cabecera || d;
      console.log("  Campos del encabezado   : " + Object.keys(cab).join(", ").slice(0, 400));
      const det = campo(d, ["detalles", "detalle", "items"], campo(cab, ["detalles", "detalle"], []));
      if(Array.isArray(det) && det.length)
        console.log("\n  Campos del detalle      : " + Object.keys(det[0]).join(", ").slice(0, 400));
      else
        console.log("\n  OJO: no encontre los detalles (los productos) en la respuesta.");
    }
    console.log("\n  Guarde 3 documentos completos en:\n   " + salida);
    console.log("  Pasame ese archivo y ajusto la traduccion a los nombres reales.\n");
    return;
  }

  const res = traducir(r);
  resumen(res);

  if(orden === "subir"){
    if(!res.filas.length) salir("No hay filas que subir. No se toco nada.");
    await subirBase(cfg, res.filas);
  }else{
    console.log("  (modo \"ver\": no se escribio nada. Para subir: node conector.js subir)\n");
  }
}

/* Solo corre cuando se lo llama directo. Al importarlo (las pruebas lo hacen)
   quedan disponibles las funciones sin ejecutar nada. */
if(require.main === module){
  main().catch(function(e){ salir("Fallo inesperado: " + (e && e.message ? e.message : e)); });
}

module.exports = { revisarEndpoint, ENDPOINTS_PERMITIDOS, traducir, comprimirBase, armarNumeroFactura, soloFecha, mesDe, sacarListaDeFacturas };
