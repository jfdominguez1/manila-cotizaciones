import { requireAuth, logout } from './auth.js';
import { db } from './firebase.js';
import { DELIVERY_TERMS, COST_UNITS, PAYMENT_TERMS } from './config.js';
import {
  collection, getDocs, deleteDoc, doc, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let currentUser = null;
let allQuotes = [];
let activeQuote = null;

async function init() {
  currentUser = await requireAuth();
  document.getElementById('nav-user').textContent = currentUser.email;
  document.getElementById('btn-logout').addEventListener('click', logout);

  populateDeliveryFilter();
  await loadQuotes();
  bindFilters();
  bindModal();
}

function populateDeliveryFilter() {
  const sel = document.getElementById('filter-delivery');
  DELIVERY_TERMS.forEach(dt => {
    const opt = document.createElement('option');
    opt.value = dt.id;
    opt.textContent = dt.name;
    sel.appendChild(opt);
  });
}

async function loadQuotes() {
  const snap = await getDocs(query(collection(db, 'quotes-local'), orderBy('created_at', 'desc')));
  allQuotes = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));

  // Poblar select de usuarios
  const users = [...new Set(allQuotes.map(q => q.created_by).filter(Boolean))];
  const userSel = document.getElementById('filter-user');
  // Clear existing options except first
  while (userSel.options.length > 1) userSel.remove(1);
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    userSel.appendChild(opt);
  });

  renderTable(allQuotes);
}

function getFiltered() {
  const client = document.getElementById('filter-client').value.toLowerCase();
  const product = document.getElementById('filter-product').value.toLowerCase();
  const delivery = document.getElementById('filter-delivery').value;
  const status = document.getElementById('filter-status').value;
  const user = document.getElementById('filter-user').value;

  return allQuotes.filter(q => {
    if (client && !((q.client?.name ?? '').toLowerCase().includes(client))) return false;
    if (product && !((q.product?.name ?? '').toLowerCase().includes(product))) return false;
    if (delivery && q.delivery_term !== delivery) return false;
    if (status && q.status !== status) return false;
    if (user && q.created_by !== user) return false;
    return true;
  });
}

function renderTable(quotes) {
  const wrap = document.getElementById('table-wrap');

  if (!quotes.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>No hay cotizaciones que coincidan con los filtros</p>
    </div>`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'quotes-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>N°</th>
        <th>Alias</th>
        <th>Fecha</th>
        <th>Cliente</th>
        <th>Ciudad</th>
        <th>Producto</th>
        <th>Entrega</th>
        <th>Precio/kg</th>
        <th>Margen%</th>
        <th>Pago</th>
        <th>Estado</th>
        <th>Usuario</th>
      </tr>
    </thead>
    <tbody id="quotes-tbody"></tbody>
  `;
  wrap.innerHTML = '';
  wrap.appendChild(table);

  const tbody = table.querySelector('#quotes-tbody');
  quotes.forEach(q => {
    const tr = document.createElement('tr');
    const dateStr = q.created_at
      ? new Date(q.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    const deliveryLabel = DELIVERY_TERMS.find(d => d.id === q.delivery_term)?.name ?? q.delivery_term ?? '—';
    const priceArs = q.price_per_kg_ars ?? 0;
    const priceUsd = q.price_per_kg_usd ?? 0;

    tr.innerHTML = `
      <td class="quote-number">${q.quote_number ?? '—'}</td>
      <td class="text-small text-muted">${q.alias || '—'}</td>
      <td>${dateStr}</td>
      <td>${q.client?.name ?? '—'}</td>
      <td>${q.client?.city ?? '—'}</td>
      <td>${q.product?.name ?? '—'}</td>
      <td>${deliveryLabel}</td>
      <td class="num">$${Math.round(priceArs).toLocaleString('es-AR')}</td>
      <td class="num">${q.margin_pct ?? 0}%</td>
      <td class="text-small">${q.payment_term_label ?? '—'}</td>
      <td><span class="status-badge ${q.status}">${q.status === 'confirmed' ? 'Confirmada' : 'Borrador'}</span></td>
      <td class="text-small text-muted">${(q.created_by ?? '').split('@')[0]}</td>
    `;

    tr.addEventListener('click', () => openDetail(q));
    tbody.appendChild(tr);
  });
}

function bindFilters() {
  ['filter-client', 'filter-product', 'filter-delivery', 'filter-status', 'filter-user'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => renderTable(getFiltered()));
  });
}

// ============================================================
// MODAL DETALLE
// ============================================================
function bindModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-modal')) closeModal();
  });

  document.getElementById('btn-edit-draft').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote-local.html?draft=${encodeURIComponent(activeQuote._docId)}`;
  });

  document.getElementById('btn-copy-quote').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote-local.html?copy=${encodeURIComponent(activeQuote._docId)}`;
  });

  document.getElementById('btn-print-client-detail').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote-local.html?draft=${encodeURIComponent(activeQuote._docId)}&print=client&readonly=1`;
  });

  document.getElementById('btn-print-internal-detail').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote-local.html?draft=${encodeURIComponent(activeQuote._docId)}&print=internal&readonly=1`;
  });

  document.getElementById('btn-delete-quote').addEventListener('click', async () => {
    if (!activeQuote) return;
    const isAdmin = currentUser?.email === 'jfdominguez@gmail.com';
    if (activeQuote.status === 'confirmed') {
      if (!isAdmin) {
        alert('Las cotizaciones confirmadas no se pueden eliminar.');
        return;
      }
      if (!confirm(`⚠️ Estás por eliminar una cotización CONFIRMADA:\n${activeQuote.quote_number}\n\nEsta acción no se puede deshacer.`)) return;
      if (!confirm(`Confirmá de nuevo: ¿eliminar definitivamente ${activeQuote.quote_number}?`)) return;
    } else {
      if (!confirm(`¿Eliminar el borrador ${activeQuote.quote_number}?`)) return;
    }
    await deleteDoc(doc(db, 'quotes-local', activeQuote._docId));
    closeModal();
    await loadQuotes();
  });
}

function openDetail(q) {
  activeQuote = q;
  document.documentElement.style.setProperty('--accent', '#2F2C2B');
  document.documentElement.style.setProperty('--accent-light', '#eaeaea');

  document.getElementById('modal-title').textContent = `${q.quote_number} — ${q.client?.name ?? ''}`;

  const isAdmin = currentUser?.email === 'jfdominguez@gmail.com';
  const deleteBtn = document.getElementById('btn-delete-quote');
  deleteBtn.style.display = (q.status === 'draft' || isAdmin) ? '' : 'none';
  deleteBtn.textContent = (q.status === 'confirmed' && isAdmin) ? 'Eliminar (Admin)' : 'Eliminar borrador';

  const editBtn = document.getElementById('btn-edit-draft');
  editBtn.style.display = q.status === 'draft' ? '' : 'none';

  const body = document.getElementById('modal-body');
  body.innerHTML = buildDetailHTML(q);

  document.getElementById('detail-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('open');
  activeQuote = null;
}

function buildDetailHTML(q) {
  const priceArs = Math.round(q.price_per_kg_ars ?? 0).toLocaleString('es-AR');
  const priceUsd = (q.price_per_kg_usd ?? 0).toFixed(2);
  const dateStr = q.created_at ? new Date(q.created_at).toLocaleString('es-AR') : '—';
  const confirmStr = q.confirmed_at ? new Date(q.confirmed_at).toLocaleString('es-AR') : '—';
  const deliveryLabel = DELIVERY_TERMS.find(d => d.id === q.delivery_term)?.name ?? q.delivery_term ?? '—';

  let html = `
    <div class="detail-price-block">
      <div>
        <div class="dpr-incoterm">${deliveryLabel}</div>
        <div class="dpr-kg">$${priceArs}/kg</div>
      </div>
      <div class="dpr-margin">Margen: ${q.margin_pct ?? 0}%</div>
    </div>

    <div class="detail-grid">
      ${q.alias ? `<div class="detail-cell" style="grid-column:1/-1">
        <div class="dc-label">Alias / Sobrenombre</div>
        <div class="dc-val" style="font-weight:600">${q.alias}</div>
      </div>` : ''}
      <div class="detail-cell">
        <div class="dc-label">Cliente</div>
        <div class="dc-val">${q.client?.name ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Ciudad</div>
        <div class="dc-val">${q.client?.city ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Contacto</div>
        <div class="dc-val">${q.client?.contact ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Dirección</div>
        <div class="dc-val">${q.client?.address ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Producto</div>
        <div class="dc-val">${q.product?.name ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Volumen</div>
        <div class="dc-val">${(q.volume_kg ?? 0).toLocaleString()} kg — ${q.num_shipments ?? 1} entrega(s)</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Condiciones de pago</div>
        <div class="dc-val" style="font-weight:600">${q.payment_term_label ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">USD/ARS</div>
        <div class="dc-val">${q.usd_ars_rate ? `$${Number(q.usd_ars_rate).toLocaleString('es-AR')}/USD` : '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Válida</div>
        <div class="dc-val">${q.valid_days ?? 15} días</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Plazo de entrega</div>
        <div class="dc-val">${q.lead_time || '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Creada por</div>
        <div class="dc-val">${q.created_by ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Fecha creación</div>
        <div class="dc-val">${dateStr}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Confirmada</div>
        <div class="dc-val">${confirmStr}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Estado</div>
        <div class="dc-val"><span class="status-badge ${q.status}">${q.status === 'confirmed' ? 'Confirmada' : 'Borrador'}</span></div>
      </div>
    </div>
  `;

  if (q.notes) {
    html += `<div class="detail-cell" style="margin-bottom:16px">
      <div class="dc-label">Notas internas</div>
      <div class="dc-val">${q.notes}</div>
    </div>`;
  }

  // Cost layers
  html += `<h4 style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--gray-500);margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--gray-200)">Detalle de costos</h4>`;

  (q.cost_layers ?? []).forEach(layer => {
    if (!layer.items?.length) return;
    const layerTotal = (layer.total_per_kg ?? 0).toFixed(4);
    html += `<div class="detail-cost-section">
      <h4>${layer.layer_name}${layer.applies_yield ? ' (ajustado por rendimiento)' : ''} <span>$${layerTotal}/kg</span></h4>`;

    layer.items.forEach(item => {
      const unitLabel = COST_UNITS.find(u => u.id === item.variable_unit)?.label ?? item.variable_unit ?? '';
      html += `<div class="detail-cost-item">
        <span class="dci-name">${item.name || '(sin nombre)'}</span>
        <span class="dci-source">${item.source === 'table' ? 'Tabla' : 'Manual'}</span>
        <span class="dci-val">
          $${(item.variable_value ?? 0).toFixed(2)} ${unitLabel}
          ${item.fixed_per_shipment ? ` + $${item.fixed_per_shipment}/ent` : ''}
          ${item.fixed_per_quote ? ` + $${item.fixed_per_quote}/coti` : ''}
          → $${(item.cost_per_kg_calc ?? 0).toFixed(4)}/kg
        </span>
      </div>`;
    });
    html += `</div>`;
  });

  // Commission
  if (q.commission) {
    const c = q.commission;
    html += `<div class="detail-cost-section">
      <h4>Comisión comercial</h4>
      <div class="detail-cost-item">
        <span class="dci-name">${c.pct}% sobre ${c.base === 'cost' ? 'costo' : c.base === 'plant_exit' ? 'salida planta' : 'precio venta'}</span>
        <span class="dci-val">
          ${c.fixed_per_shipment ? `+ $${c.fixed_per_shipment}/entrega ` : ''}
          ${c.fixed_per_quote ? `+ $${c.fixed_per_quote}/cotización` : ''}
        </span>
      </div>
    </div>`;
  }

  // Final summary
  const costArsDisplay = (q.usd_ars_rate && q.total_cost_per_kg)
    ? `$${Math.round(q.total_cost_per_kg * q.usd_ars_rate).toLocaleString('es-AR')}/kg`
    : `$${(q.total_cost_per_kg ?? 0).toFixed(3)}/kg`;
  html += `<div class="detail-price-block" style="margin-top:16px">
    <div>
      <div class="dpr-incoterm">Costo total: ${costArsDisplay}</div>
      <div class="dpr-kg">$${priceArs}/kg</div>
    </div>
    <div class="dpr-margin">Margen: ${q.margin_pct ?? 0}%</div>
  </div>`;

  return html;
}

init();
