# Cotizador Mercado Interno — Spec v2
**Fecha**: 2026-02-20
**Estado**: IMPLEMENTADO

---

## Estado de implementación

| Feature | Estado | Notas |
|---|---|---|
| Arquitectura (Firebase, Auth, Storage, páginas) | OK | Mismo proyecto Firebase |
| Navegación (dropdown Local en navbar) | OK | Todas las páginas |
| Productos locales (admin CRUD) | OK | `admin.html` tab "Productos Local" |
| Campos producto: conservación, duración, etiqueta | OK | Sesión 2026-02-20 |
| Calibre obligatorio en admin | OK | v2.3.7 — texto libre requerido |
| Selector productos muestra nombre + calibre | OK | v2.3.7 |
| Cotizador (`quote-local.html`) | OK | 5 capas de costo, comisión, ARS+USD |
| Brand switcher (3 marcas) | OK | Sesión 2026-02-20 |
| Numeración LOC-YYYY-NNN | OK | Contador atómico en Firestore |
| Auto-fill rendimiento estándar | OK | v2.3.7 — carga default_yield_pct al elegir producto |
| Galería de fotos en cotizador | OK | v2.3.6 — elegir + subir fotos desde cotización |
| Yield warning (desvío >10%) | OK | v2.3.6 — aviso naranja si rendimiento difiere del standard |
| PDF Cliente (español, ARS, detalles producto) | OK | v2.3.5 — presentación, especie, conservación, etiqueta |
| PDF Costos (interno, equiv USD, margen en $) | OK | v2.3.7 — margen en ARS/kg, equiv USD |
| Historial (`history-local.html`) | OK | Lista, modal con producto specs, editar borrador, copiar |
| Dashboard (`index.html`) | OK | Secciones export + local |
| Fotos → Firebase Storage | OK | Upload en admin y cotizador |
| Condiciones de pago | OK | 8 opciones + personalizado |
| Delivery terms locales | OK | 6 opciones con coverage check |
| Transporte | OK | 4 tipos |
| Borradores y confirmación | OK | Draft → confirmed flow |
| Admin costos: tabla agrupada + CSV export | OK | v2.3.4 — headers colapsables, fecha actualización |
| Checklist de completitud | OK | v2.3.6 — sin volumen, valida cliente/producto/entrega/ítems |

---

## Arquitectura
- **Mismo Firebase** (Firestore + Auth + Storage) que exportación
- **Mismos usuarios** de Auth
- Páginas separadas dentro de `cotizaciones/`:
  - `index.html` — Dashboard (export + local)
  - `quote-local.html` — Constructor de cotizaciones locales
  - `history-local.html` — Historial local
- Numeración propia: `LOC-YYYY-NNN` (contador atómico `local_quote_next`)
- Flujo: **borrador → confirmada**

---

## Productos Mercado Interno
**Colección Firestore:** `products-local`

| Campo | Tipo | Detalle |
|---|---|---|
| Nombre | texto | En español (ej: "Filet de trucha") |
| Presentación | texto | Filet / Entero / Ahumado |
| Especie | texto | Trucha Arcoíris default |
| Corte | texto | Con piel, sin espinas... |
| Calibre | texto | **Obligatorio**. Ej: 200-400 g, 400-600 g |
| Rendimiento | decimal | % default (50). Se auto-completa en cotizador |
| Unidad de venta | texto | kg / caja de 5 kg / bandeja |
| Conservación | select | Refrigerado / Congelado |
| Días de duración | número | Auto: Refrig=15, Cong=365, editable |
| Etiqueta de marca | select | Manila / Patagonia / Andes / Sin etiqueta |
| Foto | URL | Firebase Storage |
| Fotos adicionales | URLs[] | `available_photos` — subidas desde admin o cotizador |
| Notas | texto | Descripción para cotización |

**Selector de productos:** muestra `nombre — calibre` para fácil identificación.

---

## Cotizador Local — Features

### Galería de fotos
- Al seleccionar producto, se muestran thumbnails de todas las fotos disponibles
- Click en una foto la selecciona para el PDF
- Botón ＋ para subir foto nueva a Firebase Storage (se comprime a 800px JPEG)
- La foto elegida se guarda en el snapshot del producto al guardar

### Auto-fill rendimiento
- Al seleccionar producto, el rendimiento estándar (`default_yield_pct`) se carga automáticamente en la capa Proceso en Planta
- Solo se auto-completa si el campo está vacío (no sobreescribe un valor existente)

### Yield warning
- Compara el rendimiento efectivo vs el estándar del producto
- Si el desvío > 10%, muestra aviso naranja: "⚠ Rdto X% difiere Y% del standard (Z%)"
- Funciona incluso con rendimiento 0

### Table picker
- Al elegir fuente "Tabla" en un ítem de costo, muestra select con placeholder
- Sobreescribe nombre, moneda, valores y notas del ítem seleccionado

### Checklist de completitud
- Valida: cliente, producto, condición de entrega, al menos un ítem de costo
- No requiere volumen (a diferencia de versiones anteriores)

---

## PDF — Página del Cliente (español)
- Logo de marca seleccionable (Manila / Patagonia / Andes) con accent color dinámico
- Foto del producto (la elegida en la galería)
- Nombre del producto + specs:
  - Presentación/envase (IVP, IWP, etc.)
  - Especie
  - Conservación (Refrigerado / Congelado)
  - Vida útil (ej: "15 días")
  - Unidad de venta
  - Etiqueta de marca
- Datos del pedido: cliente, ciudad, entrega, transporte, volumen, plazo, validez
- Condiciones de pago (prominente)
- Comentarios/condiciones (si hay)
- Precio en **ARS/kg**
- **"Precios no incluyen IVA"** al pie del precio
- Footer con datos de la empresa

---

## PDF — Página de Costos (interna)
- 5 capas de costo: Materia Prima, Proceso en Planta, Materiales y Embalaje, Distribución, Otros
- Tabla con concepto, fuente, valor, fijo/entrega, costo/kg
- Resumen:
  - **Costo total** (ARS/kg)
  - **Margen aplicado** (% y ARS/kg)
  - **Precio final** (ARS/kg + equivalente USD)
- Tipo de cambio ARS/USD utilizado
- Comisión comercial configurable (sobre costo o sobre precio)

---

## Admin

### Tab "Productos Local"
- CRUD completo con todos los campos del producto local
- **Calibre obligatorio** — no se puede guardar sin calibre
- Fotos suben a **Firebase Storage**
- Cards muestran `nombre — calibre`
- Conservación con auto-fill de días (Refrig=15, Cong=365)

### Tab "Tablas de costos" (compartido export + local)
- CRUD con nombre, capa, moneda (USD/ARS), valor, unidad, fijos, notas
- **Vista tabla agrupada** por capa con headers colapsables
- **Fecha de última actualización** en cada ítem
- **Exportar CSV** — descarga en formato CSV compatible con Excel

---

## Archivos principales

| Archivo | Función |
|---|---|
| `quote-local.html` | Constructor cotizaciones locales |
| `js/quote-local.js` | Lógica completa del cotizador local (cálculo, UI, PDF, fotos) |
| `history-local.html` | Historial cotizaciones locales |
| `js/history-local.js` | Lógica historial local (filtros, modal con producto specs) |
| `admin.html` | Admin con 3 tabs (export, local, costos) |
| `js/admin.js` | CRUD productos + costos + foto Storage |
| `js/config.js` | BRANDS, DELIVERY_TERMS, LOCAL_COST_LAYERS, PAYMENT_TERMS, etc. |
| `js/firebase.js` | Firebase init (db, auth, storage) |
