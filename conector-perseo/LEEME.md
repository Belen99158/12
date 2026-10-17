# Conector Perseo → Base de facturas

Trae la base de facturas desde Perseo y la deja lista en Firebase, para que
nadie tenga que exportarla y subirla a mano.

**La página no cambia en nada.** Sigue leyendo la base de Firebase igual que
siempre. Lo único que cambia es quién la pone ahí.

---

## Por qué es un programa aparte y no está dentro de la página

**Perseo está en un servidor de la oficina.** Una página publicada en internet
no puede alcanzarlo. Abrir ese servidor a internet para lograrlo sería muy
peligroso: es el servidor contable, con todas las facturas, clientes y costos.

Este programa corre **dentro** de la red de la oficina, donde Perseo sí es
alcanzable, y solo manda datos **hacia afuera**, a Firebase. **No hay que abrir
ningún puerto ni exponer nada a internet.**

Además, la `api_key` de Perseo va en cada pedido. Si la página la llamara
directo, esa clave quedaría a la vista en el código de la página — el mismo
problema del Sheet que ya cerramos. Aquí la clave se queda en `config.json`,
en la máquina de la oficina, y ese archivo **nunca se sube a GitHub**.

---

## Qué hace falta antes de la primera prueba

**1. Una máquina dentro de la red de la oficina, con Node instalado.**
Para probar sirve cualquier PC de la oficina. Para dejarlo automático conviene
una que esté siempre prendida.
Para saber si tiene Node: abrir la consola y escribir `node --version`.
Si no lo tiene, se baja de nodejs.org (la versión LTS).

**2. La API Key de Perseo.** En Perseo:
Menú → **Administración** → **Administrador de Integraciones** → **Nuevo** →
**API Key** → **Generar API Key**.
Pedirla sobre el **Perseo de pruebas**, no el de la empresa real.

**3. La dirección del servidor de Perseo**, con su puerto
(algo como `https://192.168.1.50:8080`).

**4. Un usuario de Firebase solo para el conector.** En la consola de Firebase,
igual que creaste los de Edison y los guardias:
- Usuario: `conector@lubamaqui-devoluciones.local`
- Con su clave propia (no reutilices la de una persona)
- Y en **Realtime Database → roles**, agregarle su `uid` con el valor `ADMIN`

Es un usuario aparte a propósito: si algún día hay que cortarle el acceso, se
hace sin tocar a ninguna persona.

**5. Permitir la ruta de pruebas en las reglas de Firebase.** En la consola,
en **Realtime Database → Reglas**, agregar este bloque junto a los que ya están
(va antes de `"$other"`):

```json
"baseFacturasPruebas": {
  ".read":  "auth != null && root.child('roles').child(auth.uid).exists()",
  ".write": "auth != null && root.child('roles').child(auth.uid).exists()"
}
```

Es un bloque nuevo: **no cambia ninguna de las reglas que ya funcionan**.

---

## Cómo se usa

Copiar `config.ejemplo.json` como `config.json` y llenar los datos. Después,
desde esta carpeta, **tres pasos, de menos a más compromiso**:

### Paso 1 — Solo saludar a Perseo

```bash
node conector.js probar
```

No escribe nada en ningún lado. Solo comprueba que la clave sirva y muestra qué
campos devuelve Perseo. Deja un archivo `muestra-perseo.json` con tres facturas
completas.

**Ese archivo hay que pasármelo.** La documentación de Perseo dice qué devuelve
`facturas_consulta` pero no los nombres exactos de cada campo, así que la
traducción está hecha probando los nombres más razonables. Con una respuesta de
verdad la dejo exacta.

> `muestra-perseo.json` tiene datos de clientes reales, así que **tampoco se
> sube a GitHub** — ya está bloqueado.

### Paso 2 — Ver qué saldría

```bash
node conector.js ver
```

Trae las facturas, las traduce al formato del sistema y muestra un resumen:
cuántas filas, cuántas facturas, cuántos clientes, desde qué fecha hasta cuál, y
tres filas de ejemplo. **Tampoco escribe nada.**

Si algún campo viene vacío en más del 10% de las filas, lo avisa: eso significa
que en Perseo ese campo se llama distinto y hay que ajustar la traducción.

### Paso 3 — Subir a la ruta de pruebas

```bash
node conector.js subir
```

Sube la base a `baseFacturasPruebas` en Firebase — **una ruta aparte, que el
sistema de verdad no lee.** La base real no se toca.

---

## El candado

El programa **se niega** a escribir sobre la base real (`baseFacturas`) a menos
que se lo pida a propósito con `--si-es-la-real`. Y la revisión se hace antes de
pedirle nada a Perseo, así avisa de una vez.

Mientras `config.json` diga `"ruta": "baseFacturasPruebas"`, **no hay forma de
que esto toque lo que está usando la gente.**

---

## Las pruebas

```bash
node prueba.js
```

Corre 22 comprobaciones sin necesidad de Perseo ni de internet: el armado del
número de factura, los tres formatos de fecha, el cálculo de neto/IVA/total, que
las notas de crédito se descuenten de su factura y no se cuenten como venta, y
los distintos formatos en que Perseo podría envolver la respuesta.

La más importante es la última: toma el `descomprimirBase()` **real** de
`index.html` y comprueba que puede leer lo que genera el conector, campo por
campo. Si algún día cambia el formato de la base en la página, esta prueba
falla y avisa.

---

## Cuando ya esté probado

Para que corra solo todas las noches, en esa máquina:
**Programador de tareas de Windows** → Crear tarea básica → Diariamente (a una
hora en que nadie trabaje) → Iniciar un programa:

- Programa: `node`
- Argumentos: `conector.js subir`
- Iniciar en: la carpeta donde está este archivo

Eso recién después de que los tres pasos den bien y hayamos comparado la base de
pruebas contra la de hoy.
