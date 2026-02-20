# Cotizador Mercado Interno — Spec v1
**Fecha**: 2026-02-20
**Estado**: IMPLEMENTADO

---

## Estado de implementación

| Feature | Estado | Notas |
|---|---|---|
| Arquitectura (Firebase, Auth, páginas) | OK | Mismo proyecto Firebase |
| Navegación (dropdown Local en navbar) | OK | Todas las páginas |
| Productos locales (admin CRUD) | OK | `admin.html` tab "Productos Local" |
| Campos producto: conservación, duración, etiqueta | OK | Sesión 2026-02-20 |
| Cotizador (`quote-local.html`) | OK | 5 capas de costo, comisión, ARS+USD |
| Brand switcher (3 marcas) | OK | Sesión 2026-02-20 |
| Numeración LOC-YYYY-NNN | OK | Contador atómico en Firestore |
| PDF Cliente (español, ARS) | OK | Logo dinámico, IVA notice, detalles producto |
| PDF Costos (interno, equiv USD) | OK | Tabla completa con ARS equiv |
| Historial (`history-local.html`) | OK | Lista, modal, editar borrador, copiar |
| Dashboard (`index.html`) | OK | Secciones export + local |
| Fotos → Firebase Storage | OK | Upload a Storage en admin (export + local) |
| Condiciones de pago | OK | 8 opciones + personalizado |
| Delivery terms locales | OK | 6 opciones con coverage check |
| Transporte | OK | 4 tipos |
| Borradores y confirmación | OK | Draft → confirmed flow |

---

## Arquitectura
- **Mismo Firebase** (Firestore + Auth + Storage) que exportación
- **Mismos usuarios** de Auth
- Páginas separadas dentro de `cotizaciones/`:
  - `index.html` — Dashboard (export + local)
  - `quote-local.html` — Constructor de cotizaciones locales
  - `history-local.html` — Historial local
- Numeración propia: `LOC-YYYY-NNN` (contador atómico)
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
| Calibre | texto | 200-400 g, 400-600 g |
| Rendimiento | decimal | % default (50) |
| Unidad de venta | texto | kg / caja de 5 kg / bandeja |
| Conservación | select | Refrigerado / Congelado |
| Días de duración | número | Auto: Refrig=15, Cong=365, editable |
| Etiqueta de marca | select | Manila / Patagonia / Andes / Sin etiqueta |
| Foto | URL | Firebase Storage |
| Notas | texto | Descripción para cotización |

---

## PDF — Página del Cliente (español)
- Logo de marca seleccionable (Manila / Patagonia / Andes)
- Accent color dinámico por marca
- Productos con precios **solo en ARS**
- Info adicional: conservación, vida útil, etiqueta
- **"Precios no incluyen IVA"** al pie del precio
- Footer dinámico por marca

---

## PDF — Página de Costos (interna)
- 5 capas de costo (sin export): Raw Material, Processing, Packaging, Distribution, Other
- Comisión comercial configurable
- Equivalente USD en precio/total/margen
- Tipo de cambio ARS/USD manual

---

## Admin
- `admin.html` con 3 tabs: "Productos Export" | "Productos Local" | "Tablas de costos"
- CRUD completo para productos locales con 3 campos nuevos
- Fotos suben a **Firebase Storage** (export + local)

---

## Archivos principales

| Archivo | Función |
|---|---|
| `quote-local.html` | Constructor cotizaciones locales |
| `js/quote-local.js` | Lógica completa del cotizador local |
| `history-local.html` | Historial cotizaciones locales |
| `js/history-local.js` | Lógica historial local |
| `admin.html` | Admin con 3 tabs |
| `js/admin.js` | CRUD productos + costos + foto Storage |
| `js/config.js` | BRANDS, DELIVERY_TERMS, LOCAL_COST_LAYERS, PAYMENT_TERMS, etc. |
| `js/firebase.js` | Firebase init (db, auth, storage) |
