# Modelo de Precios Manila S.A. — Documento para Discusión Interna

**Versión:** Borrador
**Fecha:** Febrero 2026
**Confidencial — Uso Interno**

---

## El Problema

Manila tiene costos que se dividen en dos naturalezas muy distintas:

1. **Costos de producto** — los que hacen al producto en sí:
   - Materia prima (pescado vivo) ajustada por rendimiento
   - Proceso en planta (mano de obra, energía, proceso)
   - Materiales y embalaje

2. **Costos logísticos** — los que dependen del destino y del Incoterm:
   - Transporte interno (Bariloche → Buenos Aires / aeropuerto)
   - Costos de exportación (aduana, documentación, freight, seguro)

La pregunta es: **¿sobre qué base calculamos el margen y la comisión?**

---

## Los Tres Modelos

### Modelo A — Margen sobre costo total (todo adentro)

```
Mercadería + MO             $9.64 /kg
Embalaje                    $1.50 /kg
Transporte interno          $0.80 /kg
Costos exportación          $0.60 /kg
─────────────────────────────────────
Costo total                $12.54 /kg

Comisión (3% s/costo)       $0.38 /kg
─────────────────────────────────────
Base                       $12.92 /kg
Margen 20%                  $2.58 /kg
─────────────────────────────────────
PRECIO FINAL               $15.50 /kg     $7.03 /lb
```

**Ventaja:** Simple, todo en un solo cálculo.
**Desventaja:** El margen del 20% también aplica sobre el flete y aduana — sobreestima el margen real del producto y hace que el precio varíe mucho según el destino.

---

### Modelo B — Margen sobre precio de salida de planta, logística al costo

```
Mercadería + MO             $9.64 /kg
Embalaje                    $1.50 /kg
─────────────────────────────────────
Costo salida de planta     $11.14 /kg
Margen 20%                  $2.23 /kg
─────────────────────────────────────
Precio salida de planta    $13.37 /kg

Comisión (3% s/salida)      $0.40 /kg
Transporte interno          $0.80 /kg
Costos exportación          $0.60 /kg
─────────────────────────────────────
PRECIO FINAL               $15.17 /kg     $6.88 /lb
```

**Ventaja:** El margen refleja exclusivamente el valor del producto. Los costos logísticos se cargan directamente. Cada destino tiene un precio diferente, pero el margen del producto es consistente.
**Desventaja:** Más pasos para llegar al precio final. Requiere más disciplina.

---

### Modelo C — Back-calculation desde precio de mercado

```
¿A qué precio puedo vender este producto en ese mercado?
                           $15.00 /kg (precio referencia)

Menos comisión 3%:         -$0.45 /kg
Menos logística:           -$1.40 /kg
─────────────────────────────────────
Precio neto planta:        $13.15 /kg

Menos costo total:        -$12.54 /kg
─────────────────────────────────────
Margen resultante:          $0.61 /kg = 4.7%  ← ¿Te cierra?
```

**Se usa cuando:** el mercado dicta el precio (commodities, licitaciones, precios de referencia de mercado).
**Ventaja:** Parte de la realidad comercial.
**Desventaja:** El margen resulta de la ecuación, no es un objetivo. Hay que decidir si acepta o no.

---

## Comparación del impacto del Incoterm

Un mismo producto con los tres Incoterms más comunes de Manila:

| Incoterm | Logística incluida | Costo logístico | Precio final (Modelo B) |
|----------|-------------------|-----------------|------------------------|
| EXW      | Ninguna            | $0.00 /kg       | $13.77 /kg             |
| FOB BUE  | Transporte + export| $1.40 /kg       | $15.17 /kg             |
| CIF Miami| Todo + flete int'l | $3.20 /kg       | $16.97 /kg             |

Con el **Modelo B**: el margen del producto siempre es 20%, independientemente de quién paga el flete. La diferencia la pone el comprador.

Con el **Modelo A**: el margen "aparente" varía según el destino (es mayor con EXW, menor con CIF), pero el margen real del producto es en realidad menor porque se calcula sobre costos de terceros.

---

## El Tema de la Comisión

La comisión de agente/broker puede calcularse de dos formas:

### Opción 1 — % sobre precio de salida de planta
El agente cobra un porcentaje del valor del producto que Manila produce, no del flete que paga el comprador.

```
Precio salida de planta:  $13.37 /kg
Comisión 3%:              $0.40 /kg
```

**Cuándo usar:** Cuando el agente está representando a Manila en origen o en el proceso de venta del producto. El precio de venta al cliente final incluye además la logística que corresponda.

### Opción 2 — % sobre precio final de venta
El agente cobra sobre el precio total que paga el cliente.

```
Precio final:             $15.17 /kg
Comisión 3%:              $0.46 /kg
```

**Cuándo usar:** Cuando el agente maneja toda la relación comercial y recibe un porcentaje de lo que factura Manila al cliente (incluida la logística).

---

## Preguntas para Discusión

1. **¿Cómo establecemos el precio hoy?** ¿Sumamos todos los costos y aplicamos el margen? ¿O arrancamos por el precio que creemos que vale el producto en destino?

2. **¿El margen objetivo es por producto o por operación?** ¿Queremos siempre 20% en el producto, independientemente de la logística?

3. **¿Los costos logísticos son "al costo" para el cliente o también llevan margen?** Un distribuidor en USA que paga CIF ¿paga el flete real o el flete + margen Manila?

4. **¿La comisión del agente es sobre el producto o sobre la factura total?** ¿Depende de cada agente o hay una política uniforme?

5. **¿Trabajamos con precios FOB de referencia?** Muchos exportadores tienen un precio FOB base y desde ahí negocian. ¿Tendría sentido para Manila tener un "precio FOB de campaña" que se actualiza mensualmente/trimestralmente?

---

## Recomendación Preliminar

Basado en lo que es habitual en la industria pesquera de exportación premium:

**Adoptar el Modelo B como base de trabajo**, con las siguientes reglas:
- El sistema calcula el **precio de salida de planta** con el margen que Manila quiere
- Se agregan los costos logísticos según el Incoterm negociado con cada cliente
- La comisión del agente se calcula sobre el precio de salida de planta
- El precio final varía por Incoterm y destino, pero el margen del producto es consistente

Esta forma de trabajar también facilita responder rápido cuando un cliente pide precio EXW, FOB o CIF — siempre arranca del mismo precio base.

---

*Documento preparado con la herramienta de cotizaciones Manila v2.0*
*Para discusión interna — sujeto a revisión*
