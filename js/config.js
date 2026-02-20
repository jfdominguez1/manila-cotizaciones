export const BRANDS = {
  manila: {
    id: 'manila',
    name: 'Manila S.A.',
    logo: 'img/logo-manila.png',
    tagline: 'Responsibly Farmed. Naturally Premium.',
    accent: '#2F2C2B',
    accent_light: '#eaeaea'
  },
  patagonia: {
    id: 'patagonia',
    name: 'Patagonia Exquisiteces',
    logo: 'img/logo-patagonia-isologo.png',
    tagline: 'From the Crystal-Clear Waters of Alicura, Argentina',
    accent: '#40543B',
    accent_light: '#e8efe7'
  },
  andes: {
    id: 'andes',
    name: 'Andes Natural Fish',
    logo: 'img/logo-andes.png',
    tagline: 'Premium Rainbow Trout from the Heart of Patagonia',
    accent: '#365A6E',
    accent_light: '#e4ecf0'
  }
};

export const CERTIFICATIONS = {
  bap: {
    id: 'bap',
    name: 'BAP Certified',
    desc: 'Best Aquaculture Practices',
    logo: 'img/bap-logo.avif'
  },
  oie: {
    id: 'oie',
    name: 'OIE Compliant',
    desc: 'World Organisation for Animal Health',
    logo: null
  },
  ecocert: {
    id: 'ecocert',
    name: 'Ecocert Audited',
    desc: 'Annual third-party audit',
    logo: null
  }
};

export const INCOTERMS = [
  { id: 'EXW', name: 'EXW — Ex Works',           desc: 'Producto listo en planta, sin nada incluido' },
  { id: 'FCA', name: 'FCA — Free Carrier',        desc: 'Entrega al transportista designado' },
  { id: 'FOB', name: 'FOB — Free On Board',       desc: 'Puesto en el buque/avión en Buenos Aires' },
  { id: 'CFR', name: 'CFR — Cost & Freight',      desc: 'FOB + flete internacional (sin seguro)' },
  { id: 'CIF', name: 'CIF — Cost Insurance Freight', desc: 'FOB + flete internacional + seguro' },
  { id: 'DDP', name: 'DDP — Delivered Duty Paid', desc: 'Todo incluido hasta la puerta del cliente' },
];

// Capas que el vendedor debe cubrir según el Incoterm.
// Materia Prima, Proceso y Embalaje son siempre del vendedor — solo se chequean las variables.
export const INCOTERM_LAYERS = {
  EXW: { required: [],                          hint: 'El comprador retira en planta — sin flete ni exportación a cargo del vendedor' },
  FCA: { required: ['transport'],               hint: 'Incluye transporte hasta el carrier designado' },
  FOB: { required: ['transport', 'export'],     hint: 'Incluye transporte interno + costos de exportación hasta el buque' },
  CFR: { required: ['transport', 'export'],     hint: 'Incluye flete internacional — verificá que esté en Costos de Exportación' },
  CIF: { required: ['transport', 'export'],     hint: 'Incluye flete + seguro internacional — verificá que estén en Costos de Exportación' },
  DDP: { required: ['transport', 'export'],     hint: 'Incluye todo hasta destino — no olvidés aranceles e impuestos en destino' },
};

// Capas de costo en orden. applies_yield: true → el costo MP se divide por el rendimiento
export const COST_LAYERS = [
  { id: 'raw_material', name: 'Materia Prima',          applies_yield: true },
  { id: 'processing',   name: 'Proceso en Planta',      applies_yield: false },
  { id: 'packaging',    name: 'Materiales y Embalaje',  applies_yield: false },
  { id: 'transport',    name: 'Transporte Interno',     applies_yield: false },
  { id: 'export',       name: 'Costos de Exportación',  applies_yield: false },
  { id: 'other',        name: 'Otros',                  applies_yield: false },
];

// Unidades de costo variable disponibles
export const COST_UNITS = [
  { id: 'kg',        label: '/kg',      needs_unit_kg: false },
  { id: 'unit',      label: '/unidad',  needs_unit_kg: true  },
  { id: 'box',       label: '/caja',    needs_unit_kg: true  },
  { id: 'load',      label: '/carga',   needs_unit_kg: false },
  { id: 'pct_cost',  label: '% costo',  needs_unit_kg: false },
  { id: 'pct_price', label: '% precio', needs_unit_kg: false },
];

// ============================================================
// MERCADO LOCAL — Constantes
// ============================================================

export const DELIVERY_TERMS = [
  { id: 'retiro_planta',     name: 'Retiro en planta',           desc: 'El cliente retira en nuestra planta de Bariloche' },
  { id: 'puesto_bhc',        name: 'Puesto en Bariloche',        desc: 'Entrega en Bariloche ciudad' },
  { id: 'puesto_nqn',        name: 'Puesto en Neuquén',          desc: 'Entrega en ciudad de Neuquén' },
  { id: 'puesto_caba',       name: 'Puesto en CABA',             desc: 'Entrega en Capital Federal / GBA' },
  { id: 'puesto_interior',   name: 'Puesto en interior',         desc: 'Entrega en otra ciudad del interior del país' },
  { id: 'entrega_deposito',  name: 'Entrega en depósito',        desc: 'Entrega en depósito del cliente o distribuidor' },
];

// Capas requeridas según delivery term (como INCOTERM_LAYERS para export)
export const DELIVERY_TERM_LAYERS = {
  retiro_planta:    { required: [],               hint: 'El cliente retira en planta — sin flete a cargo del vendedor' },
  puesto_bhc:       { required: ['distribution'], hint: 'Incluye distribución hasta Bariloche ciudad' },
  puesto_nqn:       { required: ['distribution'], hint: 'Incluye flete refrigerado hasta Neuquén' },
  puesto_caba:      { required: ['distribution'], hint: 'Incluye flete refrigerado hasta CABA' },
  puesto_interior:  { required: ['distribution'], hint: 'Incluye flete hasta la ciudad acordada' },
  entrega_deposito: { required: ['distribution'], hint: 'Incluye entrega en depósito del cliente' },
};

// Capas de costo para mercado local (5 capas — distribution reemplaza transport+export)
export const LOCAL_COST_LAYERS = [
  { id: 'raw_material',  name: 'Materia Prima',          applies_yield: true },
  { id: 'processing',    name: 'Proceso en Planta',      applies_yield: false },
  { id: 'packaging',     name: 'Materiales y Embalaje',  applies_yield: false },
  { id: 'distribution',  name: 'Distribución',           applies_yield: false },
  { id: 'other',         name: 'Otros',                  applies_yield: false },
];

// ============================================================
// ÍTEMS OBLIGATORIOS — pre-cargados en toda cotización nueva
// ============================================================
export const MANDATORY_ITEMS = [
  { id: 'pescado',         layer: 'raw_material', name: 'Pescado' },
  { id: 'proceso',         layer: 'processing',   name: 'Proceso',           has_yield: true },
  { id: 'mo_empaque',      layer: 'processing',   name: 'MO Empaque' },
  { id: 'envase_primario', layer: 'packaging',     name: 'Envase primario' },
  { id: 'envase_sec',      layer: 'packaging',     name: 'Envase secundario' },
  { id: 'etiquetas',       layer: 'packaging',     name: 'Etiquetas' },
  { id: 'otros',           layer: 'other',         name: 'Otros' },
];

/**
 * Genera objetos de costo obligatorios con defaults según tipo de cotización.
 * @param {'export'|'local'} quoteType
 */
export function buildMandatoryItems(quoteType) {
  const isLocal = quoteType === 'local';
  return MANDATORY_ITEMS.map(mi => ({
    name: mi.name,
    mandatory: true,
    mandatory_id: mi.id,
    layer: mi.layer,
    source: 'manual',
    table_ref: null,
    currency: isLocal ? 'ARS' : 'USD',
    variable_value: 0,
    variable_unit: (isLocal && mi.layer === 'packaging') ? 'box' : 'kg',
    variable_unit_kg: (isLocal && mi.layer === 'packaging') ? 10 : null,
    fixed_per_shipment: 0,
    fixed_per_quote: 0,
    cost_per_kg_calc: 0,
    notes: '',
    ...(mi.has_yield ? { yield_pct: null } : {}),
  }));
}

export const PAYMENT_TERMS = [
  { id: 'contado',       name: 'Contado' },
  { id: '7_dias',        name: '7 días' },
  { id: '15_dias',       name: '15 días' },
  { id: '30_dias',       name: '30 días' },
  { id: '45_dias',       name: '45 días' },
  { id: '60_dias',       name: '60 días' },
  { id: 'cheque',        name: 'Cheque diferido' },
  { id: 'custom',        name: 'Personalizado' },
];

export const LOCAL_TRANSPORT_TYPES = [
  'Camión refrigerado',
  'Camión seco',
  'Utilitario',
  'Retiro en planta',
];

export const CONTACT = {
  company: 'Manila S.A.',
  address: 'Bariloche, Río Negro, Patagonia Argentina',
  email: 'info@manilapatagonia.com',
  web: 'www.manilapatagonia.com',
};

/**
 * Parsea un valor numérico aceptando tanto punto (.) como coma (,) como separador decimal.
 * Útil para usuarios con configuración regional argentina/europea (Windows usa coma).
 */
export function parseNum(str) {
  if (str === null || str === undefined || str === '') return NaN;
  return parseFloat(String(str).replace(',', '.'));
}
