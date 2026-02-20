# Modelo de Cálculos — Cotizaciones Manila

> Documentación técnica del motor de cálculo de costos, comisiones, márgenes y precios.
> Todo cálculo corre en el cliente (JavaScript), sin servidor.
> Archivos: `js/quote.js` (export, USD) y `js/quote-local.js` (local, ARS).
> Versión 2.0

---

## Principio general

El objetivo del motor es transformar todos los costos —expresados en distintas unidades, monedas y estructuras— en un único número: **costo total por kg de producto terminado**. Sobre ese número se aplica comisión y margen para obtener el precio de venta.

**Export:** costo total en USD/kg → precio de venta en USD/kg y USD/lb.
**Local:** costo total en ARS/kg → precio de venta en ARS/kg (con equivalente USD de referencia).

```
Costo total/kg → + Comisión/kg → × (1 + margen) → Precio de venta/kg
```

---

## 1. Normalización de ítems de costo a /kg

El proceso tiene dos pasos:
1. **Calcular el costo en la moneda propia del ítem** (`calcItemCostPerKgRaw`)
2. **Convertir a la moneda base si es necesario** (`calcItemCostPerKg`)

### 1a. Fórmula base (en la moneda del ítem)

Cada ítem tiene tres componentes:
- **Costo variable** — expresado en alguna de las 5 unidades posibles
- **Costo fijo por embarque/entrega** (`fixed_per_shipment`) — se distribuye entre todos los kg
- **Costo fijo por cotización** (`fixed_per_quote`) — se distribuye entre todos los kg

```
raw_per_kg = variable_per_kg + (fixed_per_shipment × num_shipments + fixed_per_quote) / volume_kg
```

### Conversión de unidades variables a /kg

| Unidad | Fórmula |
|---|---|
| `/kg` | `var_per_kg = value` |
| `/unidad` | `var_per_kg = value / variable_unit_kg` |
| `/caja` | `var_per_kg = value / variable_unit_kg` |
| `/carga` | `var_per_kg = value / volume_kg` |
| `% costo` / `% precio` | `var_per_kg = 0` (se maneja aparte como comisión) |

> `variable_unit_kg` es el peso declarado por unidad o por caja. Si no se define, se asume 1.

**Ejemplo:**
- Costo de caja: $15/caja, 10 kg/caja → `var_per_kg = 15 / 10 = 1.50/kg`
- Flete fijo: $800/embarque, 2 embarques, 10.000 kg → `fixed_per_kg = (800 × 2) / 10.000 = 0.16/kg`

### 1b. Conversión ARS → USD (solo en export)

Si el ítem tiene `currency: 'ARS'`, el valor raw (en pesos) se divide por el tipo de cambio:

```
cost_per_kg_usd = raw_per_kg / usd_ars_rate
```

Si el tipo de cambio no está ingresado (`usd_ars_rate = 0`), el costo del ítem se trata como 0 y se marca con advertencia visual.

**En cotizaciones locales:** la moneda base es ARS. Los ítems en USD se convierten a ARS multiplicando por el tipo de cambio.

**Regla clave export:** `$` siempre es ARS (pesos argentinos) — uso interno. `USD` es dólares. El precio de venta y documentos para el cliente son en USD.
**Regla clave local:** el precio de venta es en ARS. El TC se usa para referencia interna (equivalente USD en PDF costos).

**Ejemplo:**
- Mano de obra: ARS $1.750/kg
- Tipo de cambio: 1.450 ARS/USD
- `cost_usd = 1.750 / 1.450 = $1.207/kg USD`

---

## 2. Ajuste por rendimiento (solo Materia Prima)

La capa **Materia Prima** tiene `applies_yield: true`. El costo por kg (ya en la moneda base) se divide por el rendimiento para expresarlo en términos de kg de producto terminado.

```
cost_adjusted = cost_per_kg / (yield_pct / 100)
```

**Por qué:** Si el rendimiento es 50%, se necesitan 2 kg de pescado en pie para producir 1 kg de filete. El costo efectivo de la materia prima por kg terminado es el doble.

**Auto-fill del rendimiento:** Al seleccionar un producto, el sistema carga automáticamente el `default_yield_pct` del producto en la capa Proceso en Planta (si no hay un valor ya definido).

**Ejemplo con ítem en ARS (export):**
- Pescado en pie: ARS $5.075/kg
- TC: 1.450 ARS/USD → $3.50 USD/kg
- Rendimiento 50% → ajustado: `3.50 / 0.50 = $7.00/kg USD`

Todas las demás capas no aplican ajuste de rendimiento.

---

## 3. Advertencia de desvío de rendimiento

El motor compara el rendimiento efectivo (definido en la capa Proceso en Planta) con el rendimiento estándar del producto (`default_yield_pct`).

```
deviation_pct = |actual - expected| / expected × 100
```

Si `deviation_pct > 10%`, se muestra un warning visual naranja:
> ⚠ Rdto 40.0% difiere 20% del standard (50%)

Esto aplica tanto a export como a local. El warning aparece incluso si el rendimiento es 0 (caso más extremo: 100% de desvío).

---

## 4. Total de costos

```
total_cost_per_kg = Σ (cost_adjusted de cada ítem en cada capa)
```

Todos los valores están en la moneda base (USD/kg para export, ARS/kg para local) en este punto.

---

## 5. Comisión comercial

La comisión tiene dos partes:
- **Porcentaje** sobre costo o sobre precio de venta
- **Fijo distribuido**: `(fixed_per_shipment × num_shipments + fixed_per_quote) / volume_kg`

### Modo A — Comisión sobre costo (`base: 'cost'`)

```
comm_fixed_per_kg = (comm_fixed_ship × num_shipments + comm_fixed_quote) / volume_kg

comm_per_kg = total_cost × (comm_pct / 100) + comm_fixed_per_kg

cost_with_commission = total_cost + comm_per_kg

price_per_kg = cost_with_commission × (1 + margin_pct / 100)
```

**Ejemplo:**
- Costo total: $10.00/kg
- Comisión: 5% sobre costo → `comm = 10.00 × 0.05 = $0.50/kg`
- Margen: 20% → `price = 10.50 × 1.20 = $12.60/kg`

### Modo B — Comisión sobre precio de venta (`base: 'price'`)

El precio es la incógnita. Resolución con álgebra inversa:

```
price_per_kg = (total_cost + comm_fixed_per_kg) × (1 + margin_pct / 100) / (1 - comm_pct / 100)

comm_per_kg = price_per_kg × (comm_pct / 100) + comm_fixed_per_kg
```

**Ejemplo:**
- Costo total: $10.00/kg
- Comisión: 5% sobre precio, Margen: 20%
- `price = 10.00 × 1.20 / 0.95 = $12.63/kg`

> El margen siempre es sobre costo, no sobre precio final.

---

## 6. Precio de venta

### Export

```
price_per_kg  = (total_cost + comm_per_kg) × (1 + margin_pct / 100)   [modo cost]
             o = (total_cost + comm_fixed_per_kg) × (1 + margin_pct / 100) / (1 - comm_pct / 100) [modo price]

price_per_lb  = price_per_kg / 2.20462
```

Factor de conversión exacto: **1 kg = 2.20462 lb**.

### Local

```
price_ars_per_kg = (total_cost_ars + comm_ars_per_kg) × (1 + margin_pct / 100)
```

No se convierte a libras. El equivalente USD de referencia se calcula en el PDF costos:
```
equiv_usd = price_ars_per_kg / usd_ars_rate
```

---

## 7. Margen en valor absoluto

El PDF costos muestra el margen no solo en porcentaje sino también en valor absoluto:

### Export
```
margin_abs = price_per_kg - total_cost_per_kg - comm_per_kg
→ se muestra como "USD $X.XX/kg"
```

### Local
```
margin_abs = price_ars_per_kg - total_cost_ars_per_kg - comm_ars_per_kg
→ se muestra como "ARS $X.XXX/kg"
```

---

## 8. Back-cálculo desde precio objetivo

Si el usuario ingresa un **precio objetivo** (/kg), el sistema calcula el margen necesario.

### Modo comisión sobre costo:
```
comm_per_kg = total_cost × (comm_pct / 100) + comm_fixed_per_kg
base        = total_cost + comm_per_kg
new_margin  = (target_price / base - 1) × 100
```

### Modo comisión sobre precio:
```
base       = total_cost + comm_fixed_per_kg
new_margin = (target_price × (1 - comm_pct / 100) / base - 1) × 100
```

---

## 9. Validación de tipo de cambio

### En export

Si algún ítem de costo tiene `currency: 'ARS'`:

1. El campo *Cotización del dólar* se marca en rojo mientras esté vacío
2. Los ítems ARS sin TC muestran `⚠ sin TC` en lugar del resultado
3. El botón **Confirmar** queda bloqueado hasta que se ingrese el TC
4. El resumen muestra `⚠ Ítems en ARS sin TC` en rojo

Cuando el TC está ingresado:
- Cada ítem ARS muestra `ARS $X.XXX/kg → $Y.YYY/kg`
- El resumen muestra `💱 TC ARS/USD — $X.XXX/USD`
- El PDF interno incluye el TC en el breakdown de costos

### En local

El TC es de referencia para el equivalente USD en el PDF costos. No bloquea la confirmación.

---

## 10. Esquema completo de un cálculo con moneda mixta (export)

```
INPUTS:
  volume_kg      = 10.000 kg
  num_shipments  = 2
  yield_pct      = 50%
  usd_ars_rate   = 1.450 ARS/USD
  margin_pct     = 20%

CAPA: Materia Prima (applies_yield = true)
  ítem "Pescado en pie" [ARS $]:  ARS $5.075/kg
    → raw_per_kg    = 5.075 ARS/kg
    → cost_usd      = 5.075 / 1.450 = $3.50 USD/kg
    → adjusted      = 3.50 / 0.50 = $7.00/kg

CAPA: Proceso en Planta (applies_yield = false)
  ítem "Mano de obra" [ARS $]:  ARS $1.740/kg
    → cost_usd = 1.740 / 1.450 = $1.20/kg
  ítem "Energía planta" [USD]:   $0.20/kg
    → cost_usd = 0.20/kg
    → sub-total = $1.40/kg

  ⚠ Yield warning: 50% = standard → OK (no warning)
  Si fuera 40%: "⚠ Rdto 40.0% difiere 20% del standard (50%)"

CAPA: Materiales y Embalaje
  ítem "Cajas" [USD]:   $15/caja, 10 kg/caja → $1.50/kg
  ítem "Bolsas" [USD]:  $0.30/kg
    → sub-total = $1.80/kg

CAPA: Transporte Interno
  ítem "Flete BHC→EZE" [ARS $]:   ARS $1.160/embarque (fijo) × 2 embarques
    → fixed_ars = 2.320 ARS total
    → fixed_usd = 2.320 / 1.450 = $1.600 USD total
    → fixed_per_kg = 1.600 / 10.000 = $0.16/kg

CAPA: Costos de Exportación
  ítem "Flete marítimo" [USD]:  $3.200/carga → $0.32/kg
  ítem "Aduana/SENASA" [USD]:   $0.10/kg
    → sub-total = $0.42/kg

  ────────────────────────────────────────────
  TOTAL COSTOS:  $10.78/kg USD

COMISIÓN: 5% sobre costo
  comm = 10.78 × 0.05 = $0.539/kg

MARGEN: 20%
  cost_with_comm = 10.78 + 0.539 = 11.319
  price          = 11.319 × 1.20 = $13.58/kg USD
  margin_abs     = 13.58 - 11.319 = $2.26/kg USD
  price_lb       = 13.58 / 2.20462 = $6.16/lb
```

---

## 11. Resumen de las funciones clave

```javascript
// Paso 1: costo en la moneda propia del ítem
function calcItemCostPerKgRaw(item, volumeKg, numShipments) {
  let varPerKg;
  switch (item.variable_unit) {
    case 'kg':   varPerKg = item.variable_value; break;
    case 'unit':
    case 'box':  varPerKg = item.variable_value / item.variable_unit_kg; break;
    case 'load': varPerKg = item.variable_value / volumeKg; break;
    default:     varPerKg = 0;
  }
  const fixedPerKg = (item.fixed_per_shipment * numShipments + item.fixed_per_quote) / volumeKg;
  return varPerKg + fixedPerKg;
}

// Paso 2: conversión a moneda base (si es necesario)
function calcItemCostPerKg(item, volumeKg, numShipments, usdArsRate) {
  const raw = calcItemCostPerKgRaw(item, volumeKg, numShipments);
  if (item.currency === 'ARS') return usdArsRate > 0 ? raw / usdArsRate : 0;
  return raw;
}

// Ajuste rendimiento (solo Materia Prima)
adjusted = costPerKg / yieldPct;    // yieldPct como decimal: 50% → 0.50

// Comisión sobre costo
comm_per_kg = totalCost * (comm_pct/100) + commFixedPerKg;
price = (totalCost + comm_per_kg) * (1 + marginPct);

// Comisión sobre precio (álgebra inversa)
price = (totalCost + commFixedPerKg) * (1 + marginPct) / (1 - comm_pct/100);

// Conversión a libras (solo export)
price_per_lb = price_per_kg / 2.20462;

// Margen en $ absoluto
margin_abs = price_per_kg - totalCost - comm_per_kg;
```

---

## 12. Condiciones de borde

| Situación | Comportamiento |
|---|---|
| `volume_kg = 0` | `fixed_per_kg = 0` para evitar división por cero |
| `yield_pct = 0` | No se aplica ajuste (divisor forzado a 1). Yield warning muestra desvío 100% |
| `usd_ars_rate = 0` con ítems ARS (export) | Ítem contribuye $0 al costo; se muestra advertencia `⚠ sin TC` |
| `comm_pct = 100%` en modo precio | División por cero; precio indeterminado |
| Precio objetivo ≤ costo | Margen resultante negativo; se clampea a 0% |
| `price_per_kg = 0` | Botones "Confirmar", "PDF Cliente" y "PDF Costos" deshabilitados |
| Ítems ARS sin TC al confirmar (export) | Bloqueado: toast de error, foco en campo de TC |
| Rendimiento difiere >10% del standard | Warning visual naranja (no bloquea operación) |
