# Arquitectura y Diseño Funcional — Cotizaciones Manila

> Documento técnico de la aplicación interna de cotizaciones de Manila S.A.
> v1.6 — Stack: Firebase + HTML/CSS/JS vanilla + GitHub Pages

---

## 1. Vista general

```
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Pages (CDN)                         │
│  index.html · quote.html · history.html · admin.html · login.html │
│  css/style.css · js/*.js · img/                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTPS
              ┌───────────────▼───────────────┐
              │        Firebase (Google)        │
              │  ┌─────────────┐  ┌──────────┐ │
              │  │  Firestore  │  │   Auth   │ │
              │  │  (NoSQL DB) │  │ (email/  │ │
              │  │             │  │  pass)   │ │
              │  └─────────────┘  └──────────┘ │
              └───────────────────────────────┘
```

Sin servidor propio. Toda la lógica corre en el navegador del usuario. Firebase provee autenticación y base de datos en tiempo real.

---

## 2. Stack tecnológico

| Componente | Tecnología | Motivo |
|---|---|---|
| Frontend | HTML5 + CSS3 + JS ES Modules | Sin build step, fácil de mantener |
| Base de datos | Firestore (Firebase) | NoSQL, tiempo real, sin servidor |
| Autenticación | Firebase Auth (email/password) | Simple, seguro, integrado |
| PDF | `window.print()` + `@media print` CSS | Sin dependencias externas |
| Deploy | GitHub Pages (branch `gh-pages`) | Gratuito, CD automático vía git push |
| Imágenes | Archivos estáticos en `/img/` | Cargados con el sitio, sin Storage |

**Firebase project:** `cotizaciones-manila`
**Configuración:** `js/firebase.js`

---

## 3. Estructura de archivos

```
cotizaciones/
├── index.html          Dashboard con últimas cotizaciones y stats
├── quote.html          Constructor de cotizaciones (módulo principal)
├── history.html        Historial y consulta
├── admin.html          Catálogo de productos + tablas de costos
├── login.html          Pantalla de autenticación
├── seed.html           Carga de datos de ejemplo (herramienta de desarrollo)
│
├── css/
│   └── style.css       Todos los estilos: UI + @media print (PDF)
│
├── js/
│   ├── firebase.js     Inicialización Firebase (app, db, auth)
│   ├── auth.js         Helpers de autenticación (requireAuth, logout)
│   ├── config.js       Constantes de dominio: BRANDS, COST_LAYERS, INCOTERMS, CERTIFICATIONS
│   ├── quote.js        Motor de cotización (cálculo, UI, PDF, save)
│   ├── history.js      Historial: carga, filtros, modal detalle
│   └── admin.js        CRUD de productos y tablas de costos
│
├── img/
│   ├── logo-manila.png
│   ├── logo-patagonia-isologo.png
│   ├── logo-andes.png
│   ├── bap-logo.avif
│   ├── fillet-white.jpg        (y demás fotos de productos)
│   └── ...
│
└── docs/
    ├── GUIA-USUARIO.md
    ├── MODELO-CALCULOS.md
    └── ARQUITECTURA.md         ← este archivo
```

---

## 4. Módulos JavaScript

### `firebase.js`
Punto de entrada de Firebase. Exporta `db` (Firestore) y `auth` (Firebase Auth). Todos los demás módulos importan desde acá.

```
firebaseConfig → initializeApp() → getFirestore() → export db
                                 → getAuth()      → export auth
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
| `COST_LAYERS` | 6 capas de costo con `id`, `name`, `applies_yield` |
| `COST_UNITS` | 5 unidades de costo con `id`, `label`, `needs_unit_kg` |
| `CONTACT` | Datos de la empresa para footer del PDF |

---

### `quote.js` — Motor principal

Es el módulo más complejo. Gestiona todo el ciclo de vida de una cotización.

**Estado global del módulo:**
```
currentUser       Usuario autenticado
products[]        Catálogo cargado de Firestore
costTables[]      Tablas de referencia de Firestore
currentBrand      Marca activa ('manila' | 'patagonia' | 'andes')
currentProduct    Objeto producto seleccionado
currentQuoteId    ID del documento en Firestore
currentQuoteNumber  Número legible (COT-AAAA-NNN)
isDraft           Boolean
layers[]          Estado local de las capas de costo
commission{}      Estado local de la comisión
```

**Flujo de inicialización:**
```
init()
  ├── requireAuth()
  ├── loadProducts() → Firestore 'products'
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

**Numeración automática:**
- `assignQuoteNumber()` usa una **transacción atómica** de Firestore sobre el documento `metadata/counters`
- El counter `quote_next` se lee y se incrementa en una sola operación (seguro para uso concurrente)
- Formato: `COT-{año}-{número padded a 3 dígitos}` → `COT-2026-001`

**Ciclo de recálculo (`recalculate`):**
```
Lee inputs del DOM (volume_kg, num_shipments, yield_pct, margin_pct)
  ↓
Para cada capa → para cada ítem:
  calcItemCostPerKg() → normalización a $/kg
  si applies_yield: dividir por yieldPct
  actualizar display del ítem
  acumular en layerTotal
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
Actualiza DOM: totales por capa, comm total, resumen, precio highlight
```

**Guardar (`buildQuoteObject`):**
Genera el objeto snapshot completo para Firestore. Incluye:
- Todos los metadatos (cliente, marca, incoterm, volumen, etc.)
- Snapshot completo del producto (copia inmutable)
- Snapshot completo de cada capa con todos sus ítems y `cost_per_kg_calc`
- Estado de la comisión
- Resultados calculados (`total_cost_per_kg`, `price_per_kg`, `price_per_lb`)

**PDF (`printQuote(mode)`):**
- Puebla los elementos del DOM oculto `.pdf-container` con los datos actuales
- Agrega clase `print-client` o `print-internal` al `<body>`
- El CSS `@media print` muestra/oculta páginas según la clase del body
- Llama a `window.print()`
- El navegador abre el diálogo de impresión/guardar PDF

---

### `history.js`

Carga todas las cotizaciones de Firestore, las muestra en tabla y gestiona el modal de detalle.

**Flujo:**
```
init()
  ├── requireAuth()
  └── loadQuotes() → Firestore 'quotes' ORDER BY created_at DESC
        ├── poblar select de usuarios (únicos)
        └── renderTable(allQuotes)

Filtros: text inputs + selects → getFiltered() → renderTable()

Click en fila → openDetail(quote)
  └── buildDetailHTML() → muestra snapshot completo con costos
        └── Botones:
            ├── "Usar como modelo" → quote.html?copy={id}
            ├── "PDF Cliente"      → quote.html?draft={id}&print=client
            ├── "PDF Costos"       → quote.html?draft={id}&print=internal
            └── "Eliminar"         → solo borradores → deleteDoc()
```

---

### `admin.js`

CRUD de dos colecciones: `products` y `cost_tables`.

**Productos:**
- Formulario colapsable con photo picker
- Photo picker: galería de imágenes estáticas de `/img/`
- Al guardar: `setDoc()` con ID derivado del nombre (o el existente si es edición)
- Sugerencias de descripción: genera 5 textos en inglés combinando los campos del formulario

**Tablas de costos:**
- Misma estructura CRUD
- ID: nombre-normalizado + timestamp (para evitar colisiones)
- Toggle del campo `kg/unidad` según la unidad seleccionada

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
  "photo": "img/fillet-white.jpg",
  "certifications": ["bap", "oie", "ecocert"],
  "notes": "Premium Patagonian fillet...",
  "order": 0
}
```

### Colección `cost_tables`

```json
{
  "id": "flete-bhc-eze-1700000000000",
  "name": "Flete BHC → EZE",
  "layer": "transport",
  "variable_value": 0,
  "variable_unit": "kg",
  "variable_unit_kg": null,
  "fixed_per_shipment": 800,
  "fixed_per_quote": 0,
  "notes": "Transporte frigorífico Bariloche → Buenos Aires"
}
```

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
  "valid_days": 15,
  "lead_time": "7-10 días desde confirmación",
  "client_comments": "Payment: 30% advance, 70% against BL",
  "notes": "Cliente muy interesado, negociación directa",
  "selected_certs": ["bap", "oie"],

  "product": { "...snapshot completo del catálogo al momento de crear..." },

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
          "variable_value": 3.50,
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

### Documento `metadata/counters`

```json
{ "quote_next": 12 }
```

---

## 6. Generación de PDFs

Los PDFs se generan con `window.print()`, sin librerías externas.

**Estructura del DOM:**

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

**CSS `@media print`:**
- Cada `.pdf-page` tiene `page-break-after: always`
- Fuerza tamaño A4, márgenes controlados
- Oculta todo lo que no es `.pdf-container`

**Flujo de impresión desde Historial:**
```
Botón "PDF Cliente" en modal detalle
  → redirige a: quote.html?draft={id}&print=client
  → quote.js carga el draft de Firestore (loadDraft)
  → populateFromData() reconstruye todo el estado
  → setTimeout 300ms → printQuote('client')
```

---

## 7. Flujo de URL params en `quote.html`

| Param | Valor | Comportamiento |
|---|---|---|
| *(ninguno)* | — | Nueva cotización, asigna número nuevo |
| `?draft=ID` | ID de Firestore | Carga el documento, lo pone en modo edición |
| `?copy=ID` | ID de Firestore | Carga el documento, asigna número nuevo (duplicado) |
| `?draft=ID&print=client` | — | Carga draft y lanza `printQuote('client')` automáticamente |
| `?draft=ID&print=internal` | — | Carga draft y lanza `printQuote('internal')` automáticamente |

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
git commit -m "descripción del cambio"
git push origin main && git push origin main:gh-pages -f
```

- `main` → código fuente
- `gh-pages` → lo que sirve GitHub Pages
- Demora 1-2 minutos en propagarse. Ctrl+Shift+R para forzar recarga en el navegador.

**Cache-busting:** Los scripts tienen versión en el query string (`?v=15`). Al actualizar un JS, incrementar el número en el `<script src>` correspondiente del HTML.

---

## 10. Diagrama de flujo completo

```
Usuario → login.html → Firebase Auth → OK
                                      ↓
                              Dashboard (index.html)
                                   ↙    ↓    ↘
                        quote.html  history  admin.html
                             ↓
                     Nueva cotización
                             ↓
              ┌──── Selecciona producto ─────┐
              │    (carga yield default)     │
              ↓                             ↓
        Datos cliente           Agrega ítems por capa
              │                      ↓
              └────────────── recalculate() ──────────────┐
                                     ↓                    │
                         Precio en tiempo real            │
                                     ↓                    │
                         Ajusta margen / precio objetivo   │
                                     ↓                    │
                    ┌────────────────────────────────┐    │
                    │  Guardar borrador              │    │
                    │  → setDoc(draft)               │    │
                    │                                │    │
                    │  Confirmar                     │    │
                    │  → setDoc(confirmed)           │    │
                    │  → número COT definitivo       │    │
                    │                                │    │
                    │  PDF Cliente / PDF Costos      │────┘
                    │  → printQuote(mode)            │
                    │  → window.print()              │
                    └────────────────────────────────┘
                                     ↓
                          history.html → snapshot
                          permanente en Firestore
```
