# Modelo de Cálculos — Cotizaciones Manila

> Documentación técnica del motor de cálculo de costos, comisiones, márgenes y precios.
> Todo cálculo corre en el cliente (JavaScript), sin servidor. Archivo: `js/quote.js`.
> Versión 1.8

---

## Principio general

El objetivo del motor es transformar todos los costos —expresados en distintas unidades, monedas y estructuras— en un único número: **costo total en USD por kg de producto terminado**. Sobre ese número se aplica comisión y margen para obtener el precio de venta.

```
Costo total/kg (USD) → + Comisión/kg → × (1 + margen) → Precio de venta USD/kg
```

---

## 1. Normalización de ítems de costo a USD/kg

El proceso tiene dos pasos:
1. **Calcular el costo en la moneda propia del ítem** (`calcItemCostPerKgRaw`)
2. **Convertir a USD si el ítem está en ARS** (`calcItemCostPerKg`)

### 1a. Fórmula base (en la moneda del ítem)

Cada ítem tiene tres componentes:
- **Costo variable** — expresado en alguna de las 5 unidades posibles
- **Costo fijo por embarque** (`fixed_per_shipment`) — se distribuye entre todos los kg
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

### 1b. Conversión ARS → USD

Si el ítem tiene `currency: 'ARS'`, el valor raw (en pesos) se divide por el tipo de cambio:

```
cost_per_kg_usd = raw_per_kg / usd_ars_rate
```

Si el tipo de cambio no está ingresado (`usd_ars_rate = 0`), el costo del ítem se trata como 0 y se marca con advertencia visual.

**Regla clave:** `$` siempre es ARS (pesos argentinos) — uso interno únicamente. `USD` es dólares. El precio de venta y todos los documentos para el cliente son siempre en USD.

**Ejemplo:**
- Mano de obra: ARS $1.750/kg
- Tipo de cambio: 1.450 ARS/USD
- `cost_usd = 1.750 / 1.450 = $1.207/kg USD`

---

## 2. Ajuste por rendimiento (solo Materia Prima)

La capa **Materia Prima** tiene `applies_yield: true`. El costo por kg (ya en USD) se divide por el rendimiento para expresarlo en términos de kg de producto terminado.

```
cost_adjusted = cost_per_kg_usd / (yield_pct / 100)
```

**Por qué:** Si el rendimiento es 50%, se necesitan 2 kg de pescado en pie para producir 1 kg de filete. El costo efectivo de la materia prima por kg terminado es el doble.

**Ejemplo con ítem en ARS:**
- Pescado en pie: ARS $5.075/kg
- TC: 1.450 ARS/USD → $3.50 USD/kg
- Rendimiento 50% → ajustado: `3.50 / 0.50 = $7.00/kg USD`

Todas las demás capas no aplican ajuste de rendimiento.

---

## 3. Total de costos

```
total_cost_per_kg = Σ (cost_adjusted de cada ítem en cada capa)
```

Todos los valores están en USD/kg en este punto, independientemente de si el ítem original era ARS o USD.

---

## 4. Comisión comercial

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

## 5. Precio de venta

```
price_per_kg  = (total_cost + comm_per_kg) × (1 + margin_pct / 100)   [modo cost]
             o = (total_cost + comm_fixed_per_kg) × (1 + margin_pct / 100) / (1 - comm_pct / 100) [modo price]

price_per_lb  = price_per_kg / 2.20462
```

Factor de conversión exacto: **1 kg = 2.20462 lb**.

---

## 6. Back-cálculo desde precio objetivo

Si el usuario ingresa un **precio objetivo** (USD/kg), el sistema calcula el margen necesario.

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

## 7. Validación de tipo de cambio

Si algún ítem de costo tiene `currency: 'ARS'`:

1. El campo *Cotización del dólar* se marca en rojo mientras esté vacío
2. Los ítems ARS sin TC muestran `⚠ sin TC` en lugar del resultado
3. El botón **Confirmar** queda bloqueado hasta que se ingrese el TC
4. El resumen muestra `⚠ Ítems en ARS sin TC` en rojo

Cuando el TC está ingresado:
- Cada ítem ARS muestra `ARS $X.XXX/kg → $Y.YYY/kg`
- El resumen muestra `💱 TC ARS/USD — $X.XXX/USD`
- El PDF interno incluye el TC en el breakdown de costos

---

## 8. Esquema completo de un cálculo con moneda mixta

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
  price_lb       = 13.58 / 2.20462 = $6.16/lb
```

---

## 9. Resumen de las funciones clave

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

// Paso 2: conversión a USD (si el ítem es ARS)
function calcItemCostPerKg(item, volumeKg, numShipments, usdArsRate) {
  const raw = calcItemCostPerKgRaw(item, volumeKg, numShipments);
  if (item.currency === 'ARS') return usdArsRate > 0 ? raw / usdArsRate : 0;
  return raw;
}

// Ajuste rendimiento (solo Materia Prima)
adjusted = costUsd / yieldPct;    // yieldPct como decimal: 50% → 0.50

// Comisión sobre costo
comm_per_kg = totalCost * (comm_pct/100) + commFixedPerKg;
price = (totalCost + comm_per_kg) * (1 + marginPct);

// Comisión sobre precio (álgebra inversa)
price = (totalCost + commFixedPerKg) * (1 + marginPct) / (1 - comm_pct/100);

// Conversión a libras
price_per_lb = price_per_kg / 2.20462;
```

---

## 10. Condiciones de borde

| Situación | Comportamiento |
|---|---|
| `volume_kg = 0` | `fixed_per_kg = 0` para evitar división por cero |
| `yield_pct = 0` | No se aplica ajuste (divisor forzado a 1) |
| `usd_ars_rate = 0` con ítems ARS | Ítem contribuye $0 al costo; se muestra advertencia `⚠ sin TC` |
| `comm_pct = 100%` en modo precio | División por cero; precio indeterminado |
| Precio objetivo ≤ costo | Margen resultante negativo; se clampea a 0% |
| `price_per_kg = 0` | Botones "Confirmar", "PDF Cliente" y "PDF Costos" deshabilitados |
| Ítems ARS sin TC al confirmar | Bloqueado: toast de error, foco en campo de TC |
