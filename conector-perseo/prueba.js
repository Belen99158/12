/* Prueba de la traduccion Perseo -> formato del sistema, con una respuesta
   simulada. No necesita Perseo ni internet: comprueba que la logica sirve y,
   sobre todo, que lo que sale se puede volver a leer con el MISMO
   descomprimirBase() que usa index.html hoy. */
"use strict";
const { traducir, comprimirBase, armarNumeroFactura, soloFecha, mesDe } = require("./conector.js");
const fs = require("fs"), vm = require("vm");

/* --- descomprimirBase() sacado tal cual del index.html de produccion ------- */
const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const i = html.indexOf("function descomprimirBase(");
let d = 0, fin = -1;
for(let k = html.indexOf("{", i); k < html.length; k++){
  if(html[k] === "{") d++;
  else if(html[k] === "}"){ d--; if(!d){ fin = k + 1; break; } }
}
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(i, fin), ctx);
const descomprimirBase = ctx.descomprimirBase;

/* --- respuesta simulada de facturas_consulta ------------------------------ */
const respuesta = { facturas: [
  { facturas: { sri_documentoscodigo:"01", establecimiento:"002", puntoemision:"001",
      secuencial:"000092497", emision:"2026-07-09T00:00:00", total:22.08,
      identificacion:"1802398238001", razonsocial:"Almeida Murillo Myriam Priscila",
      vendedor:"stalin coba" },
    detalles: [
      { productocodigo:"ZZY1-18-100/S", descripcion:"SEIWA BOBINA ENCENDIDO MAZDA ALLEGRO",
        cantidad:1, precio:19.20, descuentovalor:0, iva:15, linea:"SEIWA" }
    ] },
  { facturas: { sri_documentoscodigo:"01", establecimiento:"002", puntoemision:"002",
      secuencial:"000014715", emision:"15/05/2026", total:97.56,
      identificacion:"1802398238001", razonsocial:"Almeida Murillo Myriam Priscila",
      vendedor:"stalin coba" },
    detalles: [
      { productocodigo:"RMM1313/LB", descripcion:"RADIADOR GRAND VITARA",
        cantidad:2, precio:42.42, descuentovalor:0, iva:15, linea:"LUBA" }
    ] },
  /* nota de credito de la primera factura: debe descontarse, no sumar ventas */
  { facturas: { sri_documentoscodigo:"04", establecimiento:"002", puntoemision:"001",
      secuencial:"000000123", emision:"2026-08-01", total:22.08,
      relacionestablecimiento:"002", relacionpuentoemision:"001", relacionsecuencia:"000092497",
      identificacion:"1802398238001", razonsocial:"Almeida Murillo Myriam Priscila" },
    detalles: [ { productocodigo:"ZZY1-18-100/S", cantidad:1, precio:19.20, iva:15 } ] }
]};

/* ---------------------------------------------------------------- pruebas -- */
let fallos = 0;
function ok(nombre, condicion, detalle){
  console.log((condicion ? "OK    " : "FALLO ") + nombre + (condicion ? "" : "   -> " + detalle));
  if(!condicion) fallos++;
}

ok("numero de factura con ceros", armarNumeroFactura({establecimiento:"2",puntoemision:"1",secuencial:"92497"}) === "002-001-000092497",
   armarNumeroFactura({establecimiento:"2",puntoemision:"1",secuencial:"92497"}));
ok("fecha ISO",        soloFecha("2026-07-09T00:00:00") === "2026-07-09", soloFecha("2026-07-09T00:00:00"));
ok("fecha dd/mm/aaaa", soloFecha("15/05/2026") === "2026-05-15", soloFecha("15/05/2026"));
ok("fecha aaaammdd",   soloFecha("20260709") === "2026-07-09", soloFecha("20260709"));
ok("mes derivado",     mesDe("2026-07-09") === "2026-07", mesDe("2026-07-09"));

const r = traducir(respuesta);
ok("la nota de credito no entra como venta", r.filas.length === 2, r.filas.length + " filas");
ok("se aplico la nota de credito", r.ncAplicadas === 1, "aplicadas=" + r.ncAplicadas + " sinFactura=" + r.ncSinFactura);

const f1 = r.filas.find(x => x.factura === "002-001-000092497");
const f2 = r.filas.find(x => x.factura === "002-002-000014715");
ok("factura 1 encontrada", !!f1, "no salio");
if(f1){
  ok("neto 1x19.20 = 19.20", Math.abs(f1.neto - 19.20) < 0.01, f1.neto);
  ok("iva 15% = 2.88",       Math.abs(f1.iva - 2.88)  < 0.01, f1.iva);
  ok("total = 22.08",        Math.abs(f1.total - 22.08) < 0.01, f1.total);
  ok("razon social en mayusculas", f1.razon === "ALMEIDA MURILLO MYRIAM PRISCILA", f1.razon);
  ok("asesor en mayusculas",       f1.facturador === "STALIN COBA", f1.facturador);
  ok("credito aplicado = total (se devolvio entera)", Math.abs(f1.creditoAplicado - 22.08) < 0.01, f1.creditoAplicado);
  ok("mes", f1.mes === "2026-07", f1.mes);
}
if(f2){
  ok("factura 2 sin credito aplicado", f2.creditoAplicado === 0, f2.creditoAplicado);
  ok("cantidad 2 x 42.42 = 84.84 neto", Math.abs(f2.neto - 84.84) < 0.01, f2.neto);
}

/* La prueba que de verdad importa: que index.html pueda leer lo que generamos */
const vuelta = descomprimirBase(comprimirBase(r.filas));
ok("index.html puede leer la base generada", vuelta.length === r.filas.length, vuelta.length);
const campos = ["emision","factura","ruc","razon","codigo","desc","sub","facturador","cant","neto","iva","total","creditoAplicado","totalDoc","mes"];
const iguales = campos.every(c => JSON.stringify(vuelta[0][c]) === JSON.stringify(r.filas[0][c]));
ok("todos los campos sobreviven ida y vuelta", iguales,
   JSON.stringify(vuelta[0]) + "  vs  " + JSON.stringify(r.filas[0]));

/* Formatos de respuesta alternativos (no sabemos cual usa Perseo) */
ok("acepta respuesta como arreglo suelto", traducir(respuesta.facturas).filas.length === 2);
ok("acepta envoltorio 'data'", traducir({ data: respuesta.facturas }).filas.length === 2);
ok("respuesta vacia no revienta", traducir({}).filas.length === 0);

/* --- el candado de solo lectura ------------------------------------------- */
/* Lo que de verdad protege a Perseo: aunque este programa apunte al servidor
   real, solo puede LEER. Se comprueba que deje pasar las consultas y que
   bloquee todo lo que escribe. */
const { revisarEndpoint } = require("./conector.js");
function bloquea(ep){
  try{ revisarEndpoint(ep); return false; }
  catch(e){ return /BLOQUEADO/.test(e.message); }
}
console.log("");
ok("deja pasar facturas_consulta",   !bloquea("facturas_consulta"));
ok("BLOQUEA facturas_crear",          bloquea("facturas_crear"));
ok("BLOQUEA facturas_autorizar",      bloquea("facturas_autorizar"));
ok("BLOQUEA clientes_eliminar",       bloquea("clientes_eliminar"));
ok("BLOQUEA crear_salidas",           bloquea("crear_salidas"));
ok("BLOQUEA productos_editar",        bloquea("productos_editar"));
ok("BLOQUEA cualquier otro endpoint", bloquea("cobros_consulta"));
console.log("\n" + (fallos ? fallos + " FALLOS" : "Todo pasa."));
process.exit(fallos ? 1 : 0);
