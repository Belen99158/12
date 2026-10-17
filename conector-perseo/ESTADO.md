# Estado de la integración con Perseo

> **Si estás leyendo esto en la compu de trabajo:** este archivo tiene todo el
> contexto de lo que se decidió y por qué. Las instrucciones de uso están en
> [LEEME.md](LEEME.md). Si abres Claude en esta carpeta, pídele que lea estos
> dos archivos y va a saber dónde quedamos.

Rama: `pruebas-perseo` · Nada de esto está en producción · `main` no se tocó.

---

## Qué estamos haciendo

Conectar Perseo (el contable) con el sistema de devoluciones y garantías.
**Primer paso elegido:** que la base de facturas se actualice sola desde
Perseo, en vez de exportarla y subirla a mano.

Lo de crear notas de crédito automáticas en Perseo **queda para después**, y
solo si hay un ambiente de pruebas de verdad. Es un documento tributario ante
el SRI: no se deshace.

---

## Las tres decisiones que ya se tomaron, y por qué

**1. El conector es un programa aparte, no parte de la página.**
Perseo PC está en un servidor de la oficina. Una página publicada en internet
(Vercel) no puede alcanzarlo, y abrir ese servidor a internet para lograrlo
sería muy peligroso: es el servidor contable. El conector corre *dentro* de la
red de la oficina y solo manda datos *hacia afuera*, a Firebase. No hay que
abrir ningún puerto.

**2. La página no cambia en una sola línea.**
Hoy lee la base de Firebase; va a seguir leyendo la base de Firebase. Lo único
que cambia es quién la deja ahí. `index.html` y `dashboard.html` están
idénticos a producción — se puede comprobar con `git diff main`.

**3. El conector es de solo lectura, y está forzado por código.**
La API Key de Perseo resultó ser **la misma para el ambiente de pruebas y el
real**, así que la clave no separa un servidor del otro: lo único que los
separa es la URL. Como eso no alcanza, el programa lleva una lista blanca de
cinco endpoints de consulta y rechaza cualquier otro antes de salir a la red,
además de rechazar por nombre todo lo que diga crear / editar / actualizar /
eliminar / autorizar / aprobar / borrar.

Consecuencia: **aunque apunte al Perseo real, ahí solo puede leer.**

---

## Lo que está hecho

- `conector.js` — cuatro modos: `direccion`, `probar`, `ver`, `subir`
- `prueba.js` — **29 pruebas, todas pasan**, sin necesitar Perseo ni internet
- Candado: se niega a escribir sobre la base real (`baseFacturas`) salvo que se
  lo pidan con `--si-es-la-real`, y lo revisa antes de pedirle nada a Perseo
- `config.json` y `muestra-perseo.json` bloqueados en `.gitignore` (llevan la
  clave y datos de clientes reales)

La prueba que más importa: toma el `descomprimirBase()` **real** de
`index.html` y comprueba que puede leer lo que genera el conector, campo por
campo. Si algún día cambia el formato de la base en la página, esa prueba falla.

---

## Lo que falta

### 1. Los datos del servidor (pedidos al proveedor de Perseo)

- La dirección exacta para llamar a la API **desde dentro de la red**, con
  puerto si lleva. Según la documentación, en el caso local probablemente no
  lleve puerto: `https://ip_local/api/...`
- Si el Perseo de pruebas es un servidor distinto, cuál es su dirección
- Si pueden dar una **API Key de solo lectura** ← la más importante

### 2. Correrlo en una máquina de la oficina

Tiene que ser una PC en la red de la oficina, con Node instalado
(`node --version` para saber si lo tiene; si no, nodejs.org, versión LTS).

```bash
node conector.js direccion 192.168.1.XX   # si no se sabe el puerto
node conector.js probar                   # solo lee, no escribe nada
```

`probar` deja un archivo `muestra-perseo.json` con tres facturas completas.
**Ese archivo hay que revisarlo**: la traducción de campos está hecha probando
los nombres más razonables, porque la documentación de Perseo dice *qué*
devuelve `facturas_consulta` pero no *cómo se llama cada campo*. Con una
respuesta real se deja exacta.

### 3. Preparar Firebase (en la consola, a mano)

- Usuario `conector@lubamaqui-devoluciones.local` con clave propia, y su `uid`
  en `roles` con valor `ADMIN`
- Un bloque nuevo en las reglas para `baseFacturasPruebas` — está copiado tal
  cual en [LEEME.md](LEEME.md). Es un bloque **nuevo**: no cambia ninguna de
  las reglas que ya funcionan.

### 4. Decidir en qué máquina vive

Para que corra solo todas las noches hace falta una PC que quede prendida.
**Esto está sin resolver.**

---

## Lo que NO hay que hacer

- No apuntar `config.json` a `baseFacturas` (la base real) hasta haber
  comparado la de pruebas contra la de hoy
- No agregar endpoints a `ENDPOINTS_PERMITIDOS` sin pensarlo mucho —
  especialmente `facturas_crear`, que con el código `"04"` emite una nota de
  crédito real ante el SRI
- No subir `config.json` ni `muestra-perseo.json` a GitHub (ya están
  bloqueados, pero que quede dicho)
