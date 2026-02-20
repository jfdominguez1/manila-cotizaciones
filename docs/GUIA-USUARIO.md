# Guía de Usuario — Cotizaciones Manila

> Sistema interno de cotizaciones para exportación y mercado local de Manila S.A.
> Versión 2.0 · Acceso: https://jfdominguez1.github.io/manila-cotizaciones/

---

## Acceso

La aplicación requiere usuario y contraseña. Pedile el acceso al administrador del sistema. Al ingresar, verás el **Dashboard** con un resumen de cotizaciones recientes (export + local) y acceso a los módulos principales.

---

## Navegación

El menú superior tiene dos dropdowns:
- **Export** → Nueva Export / Historial Export
- **Local** → Nueva Local / Historial Local
- **Admin** → Productos + Tablas de costos
- **Dashboard** → Resumen general

---

## Crear una cotización export

Ir a **Export → Nueva Export** en el menú.

### Paso 1 — Producto y marca

- Seleccioná el **producto** del menú desplegable. El selector muestra **nombre + calibre** para identificar fácilmente cada variante.
- Al elegir un producto:
  - Se carga la foto y el rendimiento estándar (default_yield_pct) en el ítem "Proceso" automáticamente
  - Aparece la sección **"Foto para PDF"** debajo del selector con thumbnails de las fotos disponibles. Hacé click en una para elegir cuál sale en el PDF del cliente. También podés subir una foto nueva con el botón **＋**.
- Elegí la **marca** con la que va a salir el PDF:
  - **Manila S.A.** — uso corporativo / mercado local
  - **Patagonia Exquisiteces** — mercado europeo / premium
  - **Andes Natural Fish** — mercado USA

### Paso 2 — Cliente

Completá los datos del comprador:
- **Nombre / Empresa** — el nombre que va a aparecer en el PDF
- **País destino** — el país al que se exporta
- **Contacto** — nombre de la persona
- **Ciudad / Puerto de destino** — ej. "Miami, FL — USA"

### Paso 3 — Operación

| Campo | Descripción |
|---|---|
| **Incoterm** | Condición de entrega: EXW, FCA, FOB, CFR, CIF, DDP |
| **Puerto de origen** | Desde dónde sale la mercadería (ej. "Buenos Aires, Argentina") |
| **Tipo de envío** | Marítimo, Aéreo, Terrestre, o refrigerado |
| **Volumen total (kg)** | Kg totales del pedido (todos los embarques juntos) |
| **N° de embarques** | Cuántas cargas fraccionadas tiene el pedido |
| **Validez (días)** | Días que tiene vigencia la oferta |
| **Lead time** | Tiempo estimado de producción y entrega (ej. "7-10 días desde confirmación") |
| **Cotización del dólar (ARS/USD)** | Tipo de cambio del día. **Obligatorio** si algún ítem de costo está en ARS $. Se muestra en el PDF interno. |

### Paso 4 — Capas de costo (columna derecha)

Este es el corazón de la cotización. Cada capa agrupa los costos de una etapa del proceso:

| Capa | Qué incluye |
|---|---|
| **Materia Prima** | Costo del pescado en pie. Se ajusta automáticamente por rendimiento |
| **Proceso en Planta** | Mano de obra, energía, fileteado, congelado. Muestra el rendimiento efectivo |
| **Materiales y Embalaje** | Bolsas, cajas, etiquetas |
| **Transporte Interno** | Flete Bariloche → Buenos Aires |
| **Costos de Exportación** | Aduana, SENASA, freight internacional, seguro |
| **Otros** | Cualquier costo adicional |

**Para agregar un ítem** dentro de una capa:
1. Clic en **＋ Agregar ítem**
2. Escribí el nombre del concepto
3. Elegí la fuente:
   - **Manual** — ingresás el valor vos mismo
   - **Tabla** — traés un valor pre-cargado desde Admin → Tablas de costos. El nombre y todos los valores se sobreescriben con los de la tabla.
4. Elegí la **moneda** del ítem (toggle en la cabecera de la fila):
   - **USD** — dólares americanos
   - **ARS $** — pesos argentinos. Se convierte a USD automáticamente usando el tipo de cambio
5. Completá los campos según la unidad elegida

**Unidades disponibles:**

| Unidad | Cuándo usarla |
|---|---|
| **/kg** | El costo ya está expresado por kg de producto terminado |
| **/unidad** | Costo por pieza; debés indicar cuántos kg pesa cada unidad |
| **/caja** | Costo por caja; debés indicar cuántos kg lleva cada caja |
| **/carga** | Costo fijo por toda la operación (ej. un contenedor) |

También hay **campos fijos**:
- **Fijo/emb.** — monto fijo que se aplica una vez por embarque (ej. $500/emb × 2 embarques = $1.000 total)
- **Fijo/coti.** — monto fijo que se aplica una sola vez a toda la cotización

**Indicadores visuales:**
- Los ítems en **ARS $** muestran borde amarillo y el resultado como `ARS $X.XXX/kg → $Y.YYY/kg`
- Si hay ítems en ARS pero no ingresaste el tipo de cambio, el campo se pone en rojo y el sistema te avisa
- El resumen de costos muestra el tipo de cambio usado o una advertencia si falta
- **Warning de rendimiento**: si el rendimiento efectivo difiere más del 10% del estándar del producto, aparece un aviso naranja en la capa Proceso en Planta (ej: "⚠ Rdto 40.0% difiere 20% del standard (50%)")

### Paso 5 — Comisión comercial

Al final de la columna derecha está la sección de **Comisión**. Completá si aplica:
- **Porcentaje** — el % acordado con el intermediario
- **Base de cálculo** — si el % se calcula sobre el costo total o sobre el precio de venta
- **Fijo/embarque y Fijo/cotización** — montos adicionales fijos si corresponden

### Paso 6 — Precio final

En el panel izquierdo, sección **Resumen de costos**, el precio se actualiza en tiempo real:
- El **Resumen** desglosa cada capa + comisión + margen
- Si hay ítems en ARS $, aparece el tipo de cambio utilizado
- Ajustá el **Margen (%)** hasta llegar al precio deseado
- O usá el campo **Precio objetivo** para ingresar el precio de venta que querés y el sistema calcula el margen necesario

El precio final siempre se muestra en **USD/kg** y **USD/lb**.

**Checklist de completitud**: en la parte superior del panel izquierdo hay un checklist que muestra qué campos faltan completar (Cliente, Producto, Incoterm, ítems obligatorios de costo).

### Paso 7 — Propuesta al cliente

- **Certificaciones a mostrar** — seleccioná cuáles van a aparecer en el PDF del cliente (BAP, OIE, Ecocert)
- **Comentarios / condiciones** — texto libre que aparece en el PDF (condiciones de pago, packaging especial, etc.)
- **Notas internas** — observaciones que NO aparecen en el PDF

### Paso 8 — Guardar o confirmar

| Acción | Qué hace |
|---|---|
| **Guardar borrador** | Guarda el estado actual. Se puede seguir editando |
| **Confirmar cotización** | Cierra la cotización con número definitivo (COT-AAAA-NNN). No se puede editar después |
| **PDF Cliente** | Genera la hoja para el cliente: foto del producto, specs (presentación/envase, corte, calibre), precio, condiciones |
| **PDF Costos** | Genera el detalle interno completo: tabla de costos por capa, margen en % y en $, hoja cliente al final |

> **Importante:** Si hay ítems en ARS $ y no ingresaste la cotización del dólar, el sistema bloquea la confirmación.

---

## Crear una cotización local (mercado interno)

Ir a **Local → Nueva Local** en el menú. El flujo es similar al de export con estas diferencias:

- **Moneda**: precios en ARS (pesos argentinos)
- **Numeración**: `LOC-YYYY-NNN`
- **Marca**: brand switcher entre Manila / Patagonia / Andes (cambia logo y colores del PDF)
- **Condición de entrega**: opciones locales (Planta Bariloche, Puesto BHC, Puesto destino, etc.)
- **Condiciones de pago**: Contado, 7/15/30/60 días, cheque, o personalizado
- **Tipo de cambio**: para referencia interna (equivalente USD en PDF costos)

**PDF Cliente local**: incluye logo de marca, foto del producto, datos del pedido, condiciones de pago, precio en ARS/kg, y detalles del producto (presentación/envase como IVP o IWP, especie, conservación, vida útil, unidad de venta, etiqueta de marca).

**PDF Costos local**: tabla de costos con equivalente USD, margen en % y en $ (ARS/kg).

---

## Historial de cotizaciones

Ir a **Historial Export** o **Historial Local** en el menú.

- Se muestran todas las cotizaciones (confirmadas y borradores) ordenadas por fecha
- Podés filtrar por cliente, producto, Incoterm/Entrega, estado y usuario
- **Clic en cualquier fila** para ver el detalle completo, incluido el desglose de costos y los datos del producto (presentación, especie, corte, calibre, conservación, etiqueta)

Desde el detalle podés:
- **Usar como modelo** — crea una cotización nueva pre-cargada con todos los datos (con número nuevo)
- **PDF Cliente** — re-genera el PDF del cliente
- **PDF Costos** — re-genera el PDF interno
- **Editar borrador** — solo borradores; abre el cotizador con los datos cargados
- **Eliminar** — solo disponible para borradores

---

## Administración

Ir a **Admin** en el menú. Tiene 3 pestañas.

### Pestaña Productos Export

Gestión del catálogo de productos disponibles para cotizar en export:
- Nombre, presentación (IVP, IWP, Bulk, etc.), especie, corte/trim
- **Calibres** (obligatorio) — al menos un rango desde-hasta. El calibre se muestra en el selector de productos y en el PDF
- Foto principal + fotos adicionales (Firebase Storage)
- Rendimiento por defecto (%)
- Certificaciones (BAP, OIE, Ecocert)
- Notas / descripción en inglés (para el PDF)
- **Botón "Sugerir descripciones"** — genera 5 descripciones en inglés listas para usar

### Pestaña Productos Local

Misma gestión pero para productos del mercado interno:
- Nombre en español, presentación, especie, corte
- **Calibre** (obligatorio) — texto libre (ej: "200-400 g, 400-600 g")
- Unidad de venta (kg, caja, bandeja)
- Conservación (Refrigerado / Congelado) y días de duración
- Etiqueta de marca (Manila / Patagonia / Andes)

### Pestaña Tablas de costos

Banco de ítems de referencia para no tener que tipear los mismos valores en cada cotización:
- Cada ítem tiene: nombre, capa, **moneda (USD / ARS $)**, valor, unidad, fijos, notas
- **Vista en tabla agrupada** por capa, con headers colapsables (click para expandir/contraer)
- Cada ítem muestra la **fecha de última actualización**
- **Exportar CSV** — botón para descargar toda la tabla en formato CSV (compatible con Excel)
- Al crear un ítem en una cotización y elegir **Fuente: Tabla**, se trae el ítem con nombre, moneda y valores automáticamente

---

## Preguntas frecuentes

**¿Puedo editar una cotización confirmada?**
No. Las cotizaciones confirmadas son un registro permanente. Si necesitás modificar algo, usá "Usar como modelo" para crear una nueva versión.

**¿Qué pasa si borro un producto del catálogo?**
Las cotizaciones existentes conservan el snapshot completo del producto tal como era en el momento de creación. El catálogo solo afecta cotizaciones futuras.

**¿El cliente ve los costos en pesos?**
No. El PDF del cliente solo muestra el precio final. Los costos internos nunca aparecen en documentos para el cliente.

**¿Cómo cambio la foto de una cotización?**
En el cotizador, debajo del selector de producto, aparece la sección "Foto para PDF" con las fotos disponibles. Hacé click en la que querés usar, o subí una nueva con el botón ＋.

**¿El PDF muestra los detalles del producto?**
Sí. El PDF del cliente muestra la presentación/envase (IVP, IWP, etc.), corte, calibre y especie debajo del nombre del producto. En local también muestra conservación, vida útil y etiqueta de marca.

**¿Qué es el warning de rendimiento?**
Aparece en naranja en la capa "Proceso en Planta" cuando el rendimiento efectivo que definiste difiere más de un 10% del rendimiento estándar del producto. Es un aviso para que revises que el valor sea correcto.

**Tengo ítems en ARS y no me deja confirmar, ¿qué hago?**
Completá el campo **Cotización del dólar (ARS/USD)** en la sección Operación/Tipo de cambio.

**¿El PDF incluye los costos?**
- **PDF Cliente** → solo muestra precio, producto (con presentación y specs), y condiciones. Sin costos internos.
- **PDF Costos** → incluye el detalle completo de costos con monedas, tipo de cambio, margen en % y en $, más una copia de la hoja del cliente.
