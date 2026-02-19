# Guía de Usuario — Cotizaciones Manila

> Sistema interno de cotizaciones para comercio exterior de Manila S.A.
> Versión 1.8 · Acceso: https://jfdominguez1.github.io/manila-cotizaciones/

---

## Acceso

La aplicación requiere usuario y contraseña. Pedile el acceso al administrador del sistema. Al ingresar, verás el **Dashboard** con un resumen de cotizaciones recientes y acceso a los módulos principales.

---

## Crear una cotización nueva

Ir a **Nueva Cotización** en el menú superior.

### Paso 1 — Producto y marca

- Seleccioná el **producto** del menú desplegable. Al elegirlo aparece la foto y se carga el rendimiento por defecto.
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
| **Rendimiento (%)** | Conversión de materia prima a producto terminado. Se carga automáticamente del producto pero se puede ajustar |
| **Validez (días)** | Días que tiene vigencia la oferta |
| **Lead time** | Tiempo estimado de producción y entrega (ej. "7-10 días desde confirmación") |
| **Cotización del dólar (ARS/USD)** | Tipo de cambio del día. **Obligatorio** si algún ítem de costo está en ARS $. Se muestra en el PDF interno. |

### Paso 4 — Capas de costo (columna derecha)

Este es el corazón de la cotización. Cada capa agrupa los costos de una etapa del proceso:

| Capa | Qué incluye |
|---|---|
| **Materia Prima** | Costo del pescado en pie. Se ajusta automáticamente por rendimiento |
| **Proceso en Planta** | Mano de obra, energía, fileteado, congelado |
| **Materiales y Embalaje** | Bolsas, cajas, etiquetas |
| **Transporte Interno** | Flete Bariloche → Buenos Aires |
| **Costos de Exportación** | Aduana, SENASA, freight internacional, seguro |
| **Otros** | Cualquier costo adicional |

**Para agregar un ítem** dentro de una capa:
1. Clic en **＋ Agregar ítem**
2. Escribí el nombre del concepto
3. Elegí la fuente:
   - **Manual** — ingresás el valor vos mismo
   - **Tabla** — traés un valor pre-cargado desde Admin → Tablas de costos
4. Elegí la **moneda** del ítem (toggle en la cabecera de la fila):
   - **USD** — dólares americanos. Aparece en todos los resúmenes y PDFs
   - **ARS $** — pesos argentinos. Solo para uso interno. Se convierte a USD automáticamente usando la Cotización del dólar. **Nunca aparece en el PDF del cliente.**
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

### Paso 7 — Propuesta al cliente

- **Certificaciones a mostrar** — seleccioná cuáles van a aparecer en el PDF del cliente (BAP, OIE, Ecocert)
- **Comentarios / condiciones** — texto libre que aparece en el PDF (condiciones de pago, packaging especial, etc.)
- **Notas internas** — observaciones que NO aparecen en el PDF

### Paso 8 — Guardar o confirmar

| Acción | Qué hace |
|---|---|
| **Guardar borrador** | Guarda el estado actual. Se puede seguir editando |
| **Confirmar cotización** | Cierra la cotización con número definitivo (COT-AAAA-NNN). No se puede editar después |
| **PDF Cliente** | Genera e imprime la hoja para el cliente (sin costos, sin pesos) |
| **PDF Costos** | Genera e imprime el detalle interno completo (2 páginas: costos + hoja cliente) |

> **Importante:** Si hay ítems en ARS $ y no ingresaste la cotización del dólar, el sistema bloquea la confirmación. Completá el campo primero.

---

## Historial de cotizaciones

Ir a **Historial** en el menú.

- Se muestran todas las cotizaciones (confirmadas y borradores) ordenadas por fecha
- Podés filtrar por cliente, producto, Incoterm, estado y usuario
- **Clic en cualquier fila** para ver el detalle completo, incluido el desglose de costos y el tipo de cambio usado

Desde el detalle podés:
- **Usar como modelo** — crea una cotización nueva pre-cargada con todos los datos (con número nuevo)
- **PDF Cliente** — re-genera el PDF del cliente
- **PDF Costos** — re-genera el PDF interno
- **Eliminar** — solo disponible para borradores (las confirmadas no se pueden eliminar)

---

## Administración (solo para usuarios con acceso)

Ir a **Admin** en el menú.

### Pestaña Productos

Gestión del catálogo de productos disponibles para cotizar:
- Nombre, presentación, especie (pre-cargado con Rainbow Trout), corte/trim, calibres
- Foto principal (se muestra en el PDF y en el selector)
- Rendimiento por defecto (%)
- Certificaciones que tiene ese producto
- Notas / descripción en inglés (para el PDF)
- **Botón "Sugerir descripciones"** — genera 5 descripciones en inglés listas para usar, basadas en los datos del formulario

### Pestaña Tablas de costos

Banco de ítems de referencia para no tener que tipear los mismos valores en cada cotización:
- Cada ítem tiene: nombre, capa, **moneda (USD / ARS $)**, valor, unidad, fijos, notas
- El badge de color en la lista indica la moneda: **azul** = USD, **amarillo** = ARS $
- Al crear un ítem en una cotización y elegir **Fuente: Tabla**, se trae el ítem con su moneda automáticamente

---

## Preguntas frecuentes

**¿Puedo editar una cotización confirmada?**
No. Las cotizaciones confirmadas son un registro permanente. Si necesitás modificar algo, usá "Usar como modelo" para crear una nueva versión.

**¿Qué pasa si borro un producto del catálogo?**
Las cotizaciones existentes conservan el snapshot completo del producto tal como era en el momento de creación. El catálogo solo afecta cotizaciones futuras.

**¿El cliente ve los costos en pesos?**
No. El PDF del cliente solo muestra el precio final en USD. Los ítems en ARS $ son estrictamente internos y nunca aparecen en documentos para el cliente.

**Tengo ítems en ARS y no me deja confirmar, ¿qué hago?**
Completá el campo **Cotización del dólar (ARS/USD)** en la sección Operación. Es obligatorio cuando hay costos en pesos para que el sistema pueda convertirlos a USD correctamente.

**¿El PDF incluye los costos?**
- **PDF Cliente** → solo muestra precio, producto, specs y condiciones. Sin costos internos ni montos en pesos.
- **PDF Costos** → incluye el detalle completo de costos con monedas y tipo de cambio (uso interno) + una copia de la hoja del cliente al final.
