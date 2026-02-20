# Arquitectura y Diseño Funcional — Cotizaciones Manila

> Documento técnico de la aplicación interna de cotizaciones de Manila S.A.
> v2.0 — Stack: Firebase + HTML/CSS/JS vanilla + GitHub Pages

---

## 1. Vista general

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHub Pages (CDN)                            │
│  index.html · quote.html · quote-local.html · history.html           │
│  history-local.html · admin.html · login.html                        │
│  css/style.css · js/*.js · img/                                      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTPS
              ┌───────────────▼───────────────┐
              │        Firebase (Google)        │
              │  ┌─────────┐ ┌──────┐ ┌──────┐│
              │  │Firestore│ │ Auth │ │Storag││
              │  │(NoSQL)  │ │(email│ │(fotos││
              │  │         │ │/pass)│ │)     ││
              │  └─────────┘ └──────┘ └──────┘│
              └───────────────────────────────┘
```

Sin servidor propio. Toda la lógica corre en el navegador del usuario. Firebase provee autenticación, base de datos en tiempo real y almacenamiento de fotos.

---

## 2. Stack tecnológico

| Componente | Tecnología | Motivo |
|---|---|---|
| Frontend | HTML5 + CSS3 + JS ES Modules | Sin build step, fácil de mantener |
| Base de datos | Firestore (Firebase) | NoSQL, tiempo real, sin servidor |
| Autenticación | Firebase Auth (email/password) | Simple, seguro, integrado |
| Almacenamiento | Firebase Storage | Fotos de productos (upload desde admin y cotizador) |
| PDF | `window.print()` + `@media print` CSS | Sin dependencias externas |
| Deploy | GitHub Pages (branch `gh-pages`) | Gratuito, CD automático vía git push |
| Imágenes estáticas | Archivos en `/img/` | Logos, certificaciones, assets fijos |

**Firebase project:** `cotizaciones-manila`
**Configuración:** `js/firebase.js`

---

## 3. Estructura de archivos

```
cotizaciones/
├── index.html          Dashboard con últimas cotizaciones (export + local) y stats
├── quote.html          Constructor de cotizaciones export
├── quote-local.html    Constructor de cotizaciones mercado interno
├── history.html        Historial export
├── history-local.html  Historial local
├── admin.html          Catálogo de productos (export + local) + tablas de costos
├── login.html          Pantalla de autenticación
├── seed.html           Carga de datos de ejemplo (herramienta de desarrollo)
│
├── css/
│   └── style.css       Todos los estilos: UI + @media print (PDF)
│
├── js/
│   ├── firebase.js     Inicialización Firebase (app, db, auth, storage)
│   ├── auth.js         Helpers de autenticación (requireAuth, logout)
│   ├── config.js       Constantes de dominio: BRANDS, COST_LAYERS, INCOTERMS, etc.
│   ├── quote.js        Motor de cotización export (cálculo, UI, PDF, save)
│   ├── quote-local.js  Motor de cotización local (cálculo ARS, UI, PDF, save)
│   ├── history.js      Historial export: carga, filtros, modal detalle
│   ├── history-local.js Historial local: carga, filtros, modal detalle
│   └── admin.js        CRUD de productos (export + local) y tablas de costos
│
├── img/
│   ├── logo-manila.png
│   ├── logo-patagonia-isologo.png
│   ├── logo-andes.png
│   ├── bap-logo.avif
│   └── ...
│
└── docs/
    ├── GUIA-USUARIO.md
    ├── MODELO-CALCULOS.md
    ├── MODELO-PRECIOS.md
    ├── SPEC-MERCADO-INTERNO.md
    └── ARQUITECTURA.md         ← este archivo
```

---

## 4. Módulos JavaScript

### `firebase.js`
Punto de entrada de Firebase. Exporta `db` (Firestore), `auth` (Firebase Auth) y `storage` (Firebase Storage). Todos los demás módulos importan desde acá.

```
firebaseConfig → initializeApp() → getFirestore() → export db
                                 → getAuth()      → export auth
                                 → getStorage()   → export storage
```

---

### `auth.js`
Tres funciones exportadas:

| Función | Comportamiento |
|---|---|
| `requireAuth()` | Promesa que resuelve con el usuario si está autenticado, o redirige a `login.html` |
| `signIn(email, pass)` | Llama a `signInWithEmailAndPassword` de Firebase |
| `logout()` | Llama a `signOut` y redirige a `login.html` |

Todas las páginas protegidas llaman `requireAuth()` como primera operación en su `init()`.

---

### `config.js`
Define las constantes de dominio del negocio. No tiene lógica, solo datos. Exporta:

| Exportación | Contenido |
|---|---|
| `BRANDS` | `{manila, patagonia, andes}` — nombre, logo, colores accent |
| `CERTIFICATIONS` | `{bap, oie, ecocert}` — nombre, descripción, logo |
| `INCOTERMS` | Array de 6 incoterms con id, nombre y descripción |
| `COST_LAYERS` | 6 capas de costo export con `id`, `name`, `applies_yield` |
| `LOCAL_COST_LAYERS` | 5 capas de costo local (sin export/aduana) |
| `COST_UNITS` | 6 unidades de costo con `id`, `label` (`/kg`, `/unidad`, etc.), `needs_unit_kg` |
| `DELIVERY_TERMS` | 6 condiciones de entrega local con `coverage` |
| `PAYMENT_TERMS` | 8+ condiciones de pago local |
| `TRANSPORT_TYPES` | 4 tipos de transporte local |
| `CONTACT` | Datos de la empresa para footer del PDF |

---

### `quote.js` — Motor de cotización export

Es el módulo más complejo. Gestiona todo el ciclo de vida de una cotización de exportación.

**Estado global del módulo:**
```
currentUser       Usuario autenticado
products[]        Catálogo cargado de Firestore (colección 'products')
costTables[]      Tablas de referencia de Firestore
currentBrand      Marca activa ('manila' | 'patagonia' | 'andes')
currentProduct    Objeto producto seleccionado
currentQuoteId    ID del documento en Firestore
currentQuoteNumber  Número legible (COT-AAAA-NNN)
isDraft           Boolean
layers[]          Estado local de las capas de costo
commission{}      Estado local de la comisión
selectedQuotePhoto  URL de la foto elegida para el PDF (null = usar photo principal)
```

**Flujo de inicialización:**
```
init()
  ├── requireAuth()
  ├── loadProducts() → Firestore 'products'
  │     └── Selector muestra nombre + calibre (ej: "Fresh Fillet — 4-6 oz, 6-8 oz")
  ├── loadCostTables() → Firestore 'cost_tables'
  ├── populateIncoterms()
  ├── renderLayers()
  ├── bindPanelEvents()
  ├── recalculate()
  └── URL params:
       ├── ?draft=ID → loadDraft() → populateFromData()
       ├── ?copy=ID  → loadCopy() → assignQuoteNumber() + populateFromData()
       └── (nuevo)   → assignQuoteNumber()
```

**Al seleccionar un producto (`onProductChange`):**
1. Carga datos del producto
2. Auto-completa el rendimiento estándar (`default_yield_pct`) en la capa Proceso
3. Renderiza la galería de fotos (`renderQuotePhotoGallery`)
4. Actualiza thumbnail del producto

**Galería de fotos del producto:**
- Combina `product.photo` + `product.available_photos` (con deduplicación)
- Muestra thumbnails clickeables para elegir la foto del PDF
- Incluye botón ＋ para subir foto nueva a Firebase Storage
- La foto seleccionada se guarda en el snapshot del producto al guardar/confirmar

**Table picker (ítems de tabla de costos):**
- Al elegir fuente "Tabla", muestra un `<select>` con ítems filtrados por capa
- Incluye placeholder "— Elegir ítem de tabla —" para forzar selección explícita
- Al seleccionar: sobreescribe nombre, moneda y todos los valores del ítem

**Yield warning (advertencia de rendimiento):**
- Compara el rendimiento efectivo (de la capa Proceso) con `product.default_yield_pct`
- Si el desvío relativo > 10%, muestra aviso naranja: "⚠ Rdto X% difiere Y% del standard (Z%)"
- Se recalcula en cada ciclo de `recalculate()`

**Numeración automática:**
- `assignQuoteNumber()` usa una **transacción atómica** de Firestore sobre el documento `metadata/counters`
- El counter `quote_next` se lee y se incrementa en una sola operación (seguro para uso concurrente)
- Formato: `COT-{año}-{número padded a 3 dígitos}` → `COT-2026-001`

**Funciones de cálculo de costo por ítem:**

| Función | Descripción |
|---|---|
| `calcItemCostPerKgRaw(item, volumeKg, numShipments)` | Devuelve el costo/kg en la **moneda propia** del ítem (ARS o USD), sin convertir |
| `calcItemCostPerKg(item, volumeKg, numShipments, usdArsRate)` | Llama a `calcItemCostPerKgRaw` y, si `item.currency === 'ARS'`, divide por `usdArsRate` para devolver USD |
| `hasArsItems()` | Devuelve `true` si algún ítem de cualquier capa tiene `currency === 'ARS'` |

**Ciclo de recálculo (`recalculate`):**
```
Lee inputs del DOM (volume_kg, num_shipments, yield_pct, margin_pct, usd_ars_rate)
  ↓
Si hasArsItems() → valida que usd_ars_rate > 0
  → si no: marca campo TC en rojo (rate-warning), muestra advertencia en resumen
  ↓
Para cada capa → para cada ítem:
  calcItemCostPerKgRaw() → costo en moneda propia (para display)
  calcItemCostPerKg()    → costo en USD (para acumular)
  si applies_yield: dividir por yieldPct
  si item.currency === 'ARS': muestra "ARS $X/kg → $Y/kg" (o "⚠ sin TC")
  acumular en layerTotal
  ↓
Yield warning: comparar yieldPct efectivo vs default del producto → mostrar/ocultar aviso
  ↓
totalCostPerKg = Σ layerTotals
  ↓
commFixedPerKg = fijos de comisión prorrateados
  ↓
si commission.base === 'cost':
    commPerKg = totalCost × commPct + commFixed
    price = (totalCost + comm) × (1 + margin)
si commission.base === 'price':
    price = (totalCost + commFixed) × (1 + margin) / (1 - commPct)
    commPerKg = price × commPct + commFixed
  ↓
pricePerLb = price / 2.20462
  ↓
Actualiza DOM: totales por capa, comm total, resumen (con nota TC), precio highlight
```

**Checklist de completitud:**
Valida que estén completos: Cliente, Producto, Incoterm, al menos un ítem de costo con valor > 0. El checklist se muestra en la parte superior del panel izquierdo.

**Guardar (`buildQuoteObject`):**
Genera el objeto snapshot completo para Firestore. Incluye:
- Todos los metadatos (cliente, marca, incoterm, volumen, `usd_ars_rate`, etc.)
- Snapshot completo del producto (copia inmutable, con la foto seleccionada)
- Snapshot completo de cada capa con todos sus ítems, `currency` y `cost_per_kg_calc`
- Estado de la comisión
- Resultados calculados (`total_cost_per_kg`, `price_per_kg`, `price_per_lb`)

**PDF (`printQuote(mode)`):**
- Puebla los elementos del DOM oculto `.pdf-container` con los datos actuales
- **PDF Cliente**: foto del producto, nombre + specs (presentación, especie, corte, calibre), precio en USD/kg y USD/lb, certificaciones, condiciones
- **PDF Costos**: tabla de costos por capa con moneda, tipo de cambio, margen en % y en $ (USD/kg), más copia de la hoja del cliente
- Agrega clase `print-client` o `print-internal` al `<body>`
- El CSS `@media print` muestra/oculta páginas según la clase del body
- Llama a `window.print()`

---

### `quote-local.js` — Motor de cotización local

Paralelo a `quote.js` pero adaptado para mercado interno argentino.

**Diferencias clave respecto a export:**
- Moneda principal: **ARS** (pesos argentinos)
- Numeración: `LOC-YYYY-NNN` (contador atómico separado: `local_quote_next`)
- Capas: 5 capas locales (sin costos de exportación/aduana)
- Condición de entrega: `DELIVERY_TERMS` (6 opciones locales)
- Condiciones de pago: `PAYMENT_TERMS` (8+ opciones)
- Productos: colección `products-local` de Firestore
- Tipo de cambio: para referencia interna (equivalente USD en PDF costos)
- Brand switcher: 3 marcas con logo y accent dinámico en PDF

**PDF Cliente local:** logo de marca, foto del producto, nombre + specs (presentación, especie, conservación, vida útil, unidad de venta, etiqueta de marca), precio en ARS/kg, "Precios no incluyen IVA", condiciones de pago.

**PDF Costos local:** tabla de costos por capa, equivalente USD, margen en % y en $ (ARS/kg).

**Features compartidas con export:** galería de fotos con upload, yield warning, auto-fill yield, table picker, checklist.

---

### `history.js` / `history-local.js`

Cargan las cotizaciones de Firestore, las muestran en tabla y gestionan el modal de detalle.

**Flujo:**
```
init()
  ├── requireAuth()
  └── loadQuotes() → Firestore 'quotes'/'quotes-local' ORDER BY created_at DESC
        ├── poblar select de usuarios (únicos)
        └── renderTable(allQuotes)

Filtros: text inputs + selects → getFiltered() → renderTable()

Click en fila → openDetail(quote)
  └── buildDetailHTML() → muestra snapshot completo con costos y detalles del producto
        │    (presentación, especie, corte, calibre, conservación, etiqueta)
        └── Botones:
            ├── "Usar como modelo" → quote(-local).html?copy={id}
            ├── "PDF Cliente"      → quote(-local).html?draft={id}&print=client
            ├── "PDF Costos"       → quote(-local).html?draft={id}&print=internal
            ├── "Editar borrador"  → solo borradores
            └── "Eliminar"         → solo borradores → deleteDoc()
```

---

### `admin.js`

CRUD de tres colecciones: `products`, `products-local` y `cost_tables`. Admin tiene 3 tabs.

**Productos Export:**
- Formulario colapsable con campos: nombre, presentación, especie, corte, calibre (obligatorio), rendimiento, certificaciones, notas
- **Calibre obligatorio**: al menos un rango desde-hasta
- Photo picker: galería de fotos subidas a Firebase Storage (`available_photos[]`)
- Al guardar: `setDoc()` con ID derivado del nombre
- El selector de productos muestra `nombre — calibre` para fácil identificación
- Sugerencias de descripción en inglés: genera 5 chips combinando datos del formulario

**Productos Local:**
- Misma estructura pero para mercado interno: nombre en español, conservación (refrig/cong), días duración (auto según conservación), etiqueta de marca, unidad de venta
- **Calibre obligatorio**: texto libre

**Tablas de costos:**
- CRUD con campos: nombre, capa, moneda (USD/ARS), valor, unidad, fijos, notas
- **Vista en tabla agrupada** por capa con headers colapsables (click para expandir/contraer)
- **Fecha de última actualización** (`updated_at`) en cada ítem
- **Exportar CSV**: botón para descargar toda la tabla en formato CSV (compatible con Excel)
- Al traer un ítem de tabla a una cotización, se copian nombre, moneda, valores y notas automáticamente

---

## 5. Modelo de datos en Firestore

### Colección `products`

```json
{
  "id": "fresh-fillet-natural",
  "name": "Fresh Natural Fillet",
  "presentation": "Fillet",
  "specs": {
    "species": "Rainbow Trout (Oncorhynchus mykiss)",
    "trim_cut": "Trim D — Skin On, Pin Bone Out",
    "caliber": "4-6 oz, 6-8 oz, 8-10 oz"
  },
  "default_yield_pct": 50,
  "photo": "https://firebasestorage.googleapis.com/...",
  "available_photos": ["url1", "url2", "..."],
  "certifications": ["bap", "oie", "ecocert"],
  "notes": "Premium Patagonian fillet...",
  "order": 0
}
```

> `photo` es la foto principal. `available_photos` es el array completo de fotos subidas a Storage. El cotizador muestra todas y permite elegir cuál usar para cada cotización.

### Colección `products-local`

```json
{
  "id": "filet-trucha-refrig",
  "name": "Filet de trucha",
  "presentation": "Filet",
  "specs": {
    "species": "Trucha Arcoíris",
    "trim_cut": "Con piel, sin espinas",
    "caliber": "200-400 g, 400-600 g"
  },
  "default_yield_pct": 50,
  "photo": "https://firebasestorage.googleapis.com/...",
  "available_photos": ["url1", "url2"],
  "conservation": "refrigerado",
  "shelf_life_days": 15,
  "sale_unit": "kg",
  "label_brand": "manila",
  "notes": "Filet premium de Patagonia...",
  "order": 0
}
```

### Colección `cost_tables`

```json
{
  "id": "flete-bhc-eze-1700000000000",
  "name": "Flete BHC → EZE",
  "layer": "transport",
  "currency": "ARS",
  "variable_value": 0,
  "variable_unit": "kg",
  "variable_unit_kg": null,
  "fixed_per_shipment": 800,
  "fixed_per_quote": 0,
  "notes": "Transporte frigorífico Bariloche → Buenos Aires",
  "updated_at": "2026-02-20T12:00:00.000Z"
}
```

> `currency`: `"USD"` (default) o `"ARS"`. Los ítems ARS se convierten a USD usando el tipo de cambio.
> `updated_at`: timestamp ISO de la última modificación. Se muestra en la vista de admin.

### Colección `quotes`

```json
{
  "quote_number": "COT-2026-001",
  "status": "confirmed",
  "created_by": "usuario@manilapatagonia.com",
  "created_at": "2026-02-19T15:30:00.000Z",
  "confirmed_at": "2026-02-19T15:32:00.000Z",

  "brand": "andes",
  "client": {
    "name": "Distribuidor ABC",
    "country": "USA",
    "contact": "John Smith",
    "dest_port": "Miami, FL — USA"
  },
  "incoterm": "CIF",
  "origin_port": "Buenos Aires, Argentina",
  "transport_type": "Marítimo Refrigerado",
  "volume_kg": 10000,
  "num_shipments": 2,
  "yield_pct": 50,
  "usd_ars_rate": 1450,
  "valid_days": 15,
  "lead_time": "7-10 días desde confirmación",
  "client_comments": "Payment: 30% advance, 70% against BL",
  "notes": "Cliente muy interesado, negociación directa",
  "selected_certs": ["bap", "oie"],

  "product": { "...snapshot completo del catálogo al momento de crear (con foto elegida)..." },

  "cost_layers": [
    {
      "layer_id": "raw_material",
      "layer_name": "Materia Prima",
      "applies_yield": true,
      "items": [
        {
          "name": "Pescado en pie",
          "source": "manual",
          "table_ref": null,
          "currency": "ARS",
          "variable_value": 5075,
          "variable_unit": "kg",
          "variable_unit_kg": null,
          "fixed_per_shipment": 0,
          "fixed_per_quote": 0,
          "cost_per_kg_calc": 7.00
        }
      ],
      "total_per_kg": 7.00
    }
  ],

  "commission": {
    "pct": 5,
    "base": "cost",
    "fixed_per_shipment": 0,
    "fixed_per_quote": 0
  },

  "total_cost_per_kg": 10.38,
  "margin_pct": 20,
  "price_per_kg": 13.38,
  "price_per_lb": 6.07
}
```

### Colección `quotes-local`

Misma estructura que `quotes` pero con campos locales:
- `quote_number`: `LOC-YYYY-NNN`
- `delivery_term` en lugar de `incoterm`
- `payment_terms` (condiciones de pago)
- `transport_type` (local)
- Precio en ARS/kg en lugar de USD/kg y USD/lb
- Producto de la colección `products-local`

### Documento `metadata/counters`

```json
{
  "quote_next": 12,
  "local_quote_next": 5
}
```

---

## 6. Generación de PDFs

Los PDFs se generan con `window.print()`, sin librerías externas.

**Estructura del DOM (export):**

```
<body>
  <nav class="topnav">        → siempre oculta en print
  <div class="quote-layout">  → oculta en print
  <div class="pdf-container"> → visible solo en print
    <div class="pdf-page pdf-internal-page">  → Página 1: costos internos
    <div class="pdf-page pdf-client-page">    → Página 2: propuesta cliente
```

**Control por clase del `<body>`:**

| Clase | Página 1 (interna) | Página 2 (cliente) |
|---|---|---|
| `print-client` | Oculta | Visible |
| `print-internal` | Visible | Visible |

**Contenido del PDF Cliente (export):**
- Logo de marca (Manila/Patagonia/Andes)
- Foto del producto (la elegida en el photo picker)
- Nombre del producto + specs: presentación, especie, corte, calibre
- Notas del producto (descripción en inglés)
- Datos del pedido: cliente, destino, incoterm, volumen, embarques, validez
- Certificaciones seleccionadas (BAP, OIE, Ecocert)
- Precio en USD/kg y USD/lb

**Contenido del PDF Cliente (local):**
- Logo de marca con accent color dinámico
- Foto del producto
- Nombre + specs: presentación, especie, conservación, vida útil, unidad de venta, etiqueta de marca
- Datos del pedido: cliente, ciudad, entrega, transporte, volumen, plazo
- Condiciones de pago
- Precio en ARS/kg + "Precios no incluyen IVA"

**Contenido del PDF Costos (ambos):**
- Tabla de costos por capa con concepto, fuente, valor, fijos, costo/kg
- Resumen: costo total, margen en % y en $ (USD/kg para export, ARS/kg para local), precio final
- En local: equivalente USD del precio final (usando TC)
- Tipo de cambio utilizado

**CSS `@media print`:**
- Cada `.pdf-page` tiene `page-break-after: always`
- Fuerza tamaño A4, márgenes controlados
- Oculta todo lo que no es `.pdf-container`

**Flujo de impresión desde Historial:**
```
Botón "PDF Cliente" en modal detalle
  → redirige a: quote(-local).html?draft={id}&print=client
  → quote(-local).js carga el draft de Firestore (loadDraft)
  → populateFromData() reconstruye todo el estado
  → setTimeout 300ms → printQuote('client')
```

---

## 7. Flujo de URL params

### `quote.html`

| Param | Valor | Comportamiento |
|---|---|---|
| *(ninguno)* | — | Nueva cotización, asigna número nuevo |
| `?draft=ID` | ID de Firestore | Carga el documento, lo pone en modo edición |
| `?copy=ID` | ID de Firestore | Carga el documento, asigna número nuevo (duplicado) |
| `?draft=ID&print=client` | — | Carga draft y lanza `printQuote('client')` automáticamente |
| `?draft=ID&print=internal` | — | Carga draft y lanza `printQuote('internal')` automáticamente |

### `quote-local.html`

Mismos params pero usa colección `quotes-local` y numeración `LOC-YYYY-NNN`.

---

## 8. Autenticación y seguridad

- Todos los módulos llaman `requireAuth()` antes de hacer cualquier operación
- Si el token de Firebase expiró o el usuario no está logueado, redirige a `login.html`
- Firebase Security Rules (Firestore) deben configurarse para que solo usuarios autenticados puedan leer/escribir
- Las cotizaciones confirmadas no tienen restricción técnica de escritura en el cliente, pero la UI deshabilita los botones de edición

**Reglas Firestore recomendadas:**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 9. Deploy

```bash
# Actualizar aplicación
git add -A
git commit -m "descripción del cambio vX.Y.Z"
git push origin main && git push origin main:gh-pages -f
```

- `main` → código fuente
- `gh-pages` → lo que sirve GitHub Pages
- Demora 1-2 minutos en propagarse. Ctrl+Shift+R para forzar recarga en el navegador.

**Cache-busting:** Los scripts y CSS tienen versión en el query string (`?v=15`). Al actualizar un JS o CSS, incrementar el número en el `<script src>` o `<link href>` correspondiente del HTML.

**Versionado:** Cada deploy incrementa la versión semver (v2.3.1, v2.3.2...) que se muestra en `<span class="nav-version">` de todos los HTML.

---

## 10. Diagrama de flujo completo

```
Usuario → login.html → Firebase Auth → OK
                                      ↓
                              Dashboard (index.html)
                              [Export + Local stats]
                                ↙     ↓     ↘
                 quote.html  history  admin.html  quote-local.html  history-local
                      ↓                  ↓              ↓
               Nueva export        3 tabs:         Nueva local
                      ↓           Export/Local/     ↓
       ┌── Selecciona producto    Costos     Selecciona producto ──┐
       │   (calibre en nombre)                (calibre en nombre)  │
       │   (auto-fill yield)                  (auto-fill yield)    │
       ↓                                                           ↓
  Galería fotos                                               Galería fotos
  (elegir/subir)                                              (elegir/subir)
       ↓                                                           ↓
  Datos cliente               Agregar ítems por capa          Datos cliente
  Incoterm, envío             (manual o desde tabla)          Entrega, pago
       │                             ↓                             │
       └───────────── recalculate() ──────────────┐               │
                            ↓                      │               │
              Precio en tiempo real                │               │
              Yield warning (si desvío >10%)       │               │
                            ↓                      │               │
              Ajusta margen / precio objetivo       │               │
                            ↓                      │               │
           ┌────────────────────────────────┐      │               │
           │  Guardar borrador              │      │               │
           │  Confirmar (COT/LOC definitivo)│──────┘               │
           │  PDF Cliente / PDF Costos      │──────────────────────┘
           └────────────────────────────────┘
                            ↓
                 history(-local).html → snapshot
                 permanente en Firestore
                 → modal detalle con producto specs
                 → Usar como modelo / reimprimir PDF
```
