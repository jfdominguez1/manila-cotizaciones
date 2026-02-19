# Modelo de Cálculos — Cotizaciones Manila

> Documentación técnica del motor de cálculo de costos, comisiones, márgenes y precios.
> Todo cálculo corre en el cliente (JavaScript), sin servidor. Archivo: `js/quote.js`.

---

## Principio general

El objetivo del motor es transformar todos los costos —expresados en distintas unidades y estructuras— en un único número: **costo total en USD por kg de producto terminado**. Sobre ese número se aplica comisión y margen para obtener el precio de venta.

```
Costo total/kg → + Comisión/kg → × (1 + margen) → Precio de venta USD/kg
```

---

## 1. Normalización de ítems de costo a $/kg

Cada ítem tiene tres componentes:
1. **Costo variable** — expresado en alguna de las 5 unidades posibles
2. **Costo fijo por embarque** (`fixed_per_shipment`) — se distribuye entre todos los kg
3. **Costo fijo por cotización** (`fixed_per_quote`) — se distribuye entre todos los kg

### Fórmula base

```
cost_per_kg = variable_per_kg + (fixed_per_shipment × num_shipments + fixed_per_quote) / volume_kg
```

### Conversión de unidades variables a $/kg

| Unidad | Fórmula |
|---|---|
| `$/kg` | `var_per_kg = value` |
| `$/unidad` | `var_per_kg = value / variable_unit_kg` |
| `$/caja` | `var_per_kg = value / variable_unit_kg` |
| `$/carga` | `var_per_kg = value / volume_kg` |
| `% costo` / `% precio` | `var_per_kg = 0` (se maneja aparte como comisión) |

> `variable_unit_kg` es el peso declarado por unidad o por caja. Si no se define, se asume 1.

**Ejemplo:**
- Costo de caja: $15/caja, 10 kg/caja → `var_per_kg = 15 / 10 = $1.50/kg`
- Flete fijo: $800/embarque, 2 embarques, 10.000 kg → `fixed_per_kg = (800 × 2) / 10.000 = $0.16/kg`

---

## 2. Ajuste por rendimiento (solo Materia Prima)

La capa **Materia Prima** tiene `applies_yield: true`. Esto significa que el costo calculado en $/kg de producto en pie se divide por el rendimiento para expresarlo en $/kg de producto terminado.

```
cost_adjusted = cost_per_kg / (yield_pct / 100)
```

**Por qué:** Si el rendimiento es 50%, se necesitan 2 kg de pescado en pie para producir 1 kg de filete. Por lo tanto, el costo de materia prima efectivo por kg de producto terminado es el doble.

**Ejemplo:**
- Costo pescado en pie: $3.50/kg
- Rendimiento: 50%
- Costo ajustado: `3.50 / 0.50 = $7.00/kg` de producto terminado

Todas las demás capas (proceso, embalaje, transporte, exportación, otros) **no** aplican ajuste de rendimiento: ya se expresan en términos del producto terminado.

---

## 3. Total de costos

```
total_cost_per_kg = Σ (cost_adjusted de cada ítem en cada capa)
```

Cada capa calcula su sub-total y la suma de todos los sub-totales da el costo total.

---

## 4. Comisión comercial

La comisión tiene dos partes:
- **Porcentaje** sobre costo o sobre precio de venta
- **Fijo distribuido**: `(fixed_per_shipment × num_shipments + fixed_per_quote) / volume_kg`

### Modo A — Comisión sobre costo (`base: 'cost'`)

Es el modo más simple. La comisión se calcula sobre el costo total.

```
comm_fixed_per_kg = (comm_fixed_ship × num_shipments + comm_fixed_quote) / volume_kg

comm_per_kg = total_cost × (comm_pct / 100) + comm_fixed_per_kg

cost_with_commission = total_cost + comm_per_kg

price_per_kg = cost_with_commission × (1 + margin_pct / 100)
```

**Ejemplo:**
- Costo total: $10.00/kg
- Comisión: 5% sobre costo
- Margen: 20%
- `comm_per_kg = 10.00 × 0.05 = $0.50/kg`
- `cost_with_comm = 10.50`
- `price = 10.50 × 1.20 = $12.60/kg`

### Modo B — Comisión sobre precio de venta (`base: 'price'`)

Más complejo porque el precio es la incógnita. Se resuelve con álgebra inversa.

El precio debe satisfacer simultáneamente:
- La comisión es X% del precio de venta
- El margen es Y% sobre el costo

La resolución es:

```
price_per_kg = (total_cost + comm_fixed_per_kg) × (1 + margin_pct / 100) / (1 - comm_pct / 100)

comm_per_kg = price_per_kg × (comm_pct / 100) + comm_fixed_per_kg
```

**Ejemplo:**
- Costo total: $10.00/kg
- Comisión: 5% sobre precio de venta
- Margen: 20%
- `price = 10.00 × 1.20 / (1 - 0.05) = 12.00 / 0.95 = $12.63/kg`
- `comm = 12.63 × 0.05 = $0.63/kg`

> **Nota:** El margen siempre es sobre costo, no sobre precio final. La diferencia entre modos está únicamente en la base de cálculo de la comisión.

---

## 5. Precio de venta

```
price_per_kg  = (total_cost + comm_per_kg) × (1 + margin_pct / 100)   [modo cost]
             o = (total_cost + comm_fixed_per_kg) × (1 + margin_pct / 100) / (1 - comm_pct / 100) [modo price]

price_per_lb  = price_per_kg / 2.20462
```

El factor de conversión kg → lb es exacto: **1 kg = 2.20462 lb**.

---

## 6. Back-cálculo desde precio objetivo

Si el usuario ingresa un **precio objetivo** (USD/kg), el sistema calcula el margen necesario para alcanzarlo, manteniendo fijos los costos y la comisión.

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

El margen resultante se escribe en el campo **Margen (%)** y se dispara un `recalculate()` para refrescar todos los valores.

---

## 7. Esquema completo de un cálculo

```
INPUTS:
  volume_kg = 10.000 kg
  num_shipments = 2
  yield_pct = 50%
  margin_pct = 20%

CAPA: Materia Prima (applies_yield = true)
  ítem "Pescado en pie":  $3.50/kg
    → cost_per_kg = 3.50
    → adjusted    = 3.50 / 0.50 = $7.00/kg

CAPA: Proceso en Planta (applies_yield = false)
  ítem "Mano de obra":    $0.80/kg
  ítem "Energía planta":  $0.20/kg
    → sub-total = $1.00/kg

CAPA: Materiales y Embalaje
  ítem "Cajas":           $15/caja, 10 kg/caja → $1.50/kg
  ítem "Bolsas vacío":    $0.30/kg
    → sub-total = $1.80/kg

CAPA: Transporte Interno
  ítem "Flete BHC→EZE":   $800/embarque (fijo) × 2 embarques = $1.600 total
    → fixed_per_kg = 1.600 / 10.000 = $0.16/kg

CAPA: Costos de Exportación
  ítem "Flete marítimo":  $3.200/carga → $3.200 / 10.000 = $0.32/kg
  ítem "Aduana/SENASA":   $0.10/kg
    → sub-total = $0.42/kg

  ────────────────────────────────────────────
  TOTAL COSTOS:           $10.38/kg

COMISIÓN: 5% sobre costo
  comm = 10.38 × 0.05 = $0.519/kg

MARGEN: 20%
  cost_with_comm = 10.38 + 0.519 = 10.899
  price          = 10.899 × 1.20 = $13.08/kg
  price_lb       = 13.08 / 2.20462 = $5.93/lb
```

---

## 8. Resumen de las fórmulas clave

```javascript
// Normalización de ítem a $/kg
function calcItemCostPerKg(item, volumeKg, numShipments) {
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

// Ajuste rendimiento (solo Materia Prima)
adjusted = cost_per_kg / yieldPct;    // yieldPct como decimal: 50% → 0.50

// Comisión sobre costo
comm_per_kg = totalCost * (comm_pct/100) + commFixedPerKg;
price = (totalCost + comm_per_kg) * (1 + marginPct);

// Comisión sobre precio (álgebra inversa)
price = (totalCost + commFixedPerKg) * (1 + marginPct) / (1 - comm_pct/100);

// Conversión de moneda de peso
price_per_lb = price_per_kg / 2.20462;
```

---

## 9. Condiciones de borde

| Situación | Comportamiento |
|---|---|
| `volume_kg = 0` | `fixed_per_kg = 0` para evitar división por cero |
| `yield_pct = 0` | No se aplica ajuste (divisor forzado a 1) |
| `comm_pct = 100%` en modo precio | División por cero; el precio es indeterminado |
| Precio objetivo ≤ costo | El margen resultante es negativo o cero; se clampea a 0% |
| `price_per_kg = 0` | Los botones "Confirmar", "PDF Cliente" y "PDF Costos" quedan deshabilitados |
