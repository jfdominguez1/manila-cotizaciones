import { requireAuth, logout } from './auth.js';
import { db } from './firebase.js';
import { BRANDS, CERTIFICATIONS, COST_UNITS } from './config.js';
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

  await loadQuotes();
  bindFilters();
  bindModal();
}

async function loadQuotes() {
  const snap = await getDocs(query(collection(db, 'quotes'), orderBy('created_at', 'desc')));
  allQuotes = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));

  // Poblar select de usuarios
  const users = [...new Set(allQuotes.map(q => q.created_by).filter(Boolean))];
  const userSel = document.getElementById('filter-user');
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
  const incoterm = document.getElementById('filter-incoterm').value;
  const status = document.getElementById('filter-status').value;
  const user = document.getElementById('filter-user').value;

  return allQuotes.filter(q => {
    if (client && !((q.client?.name ?? '').toLowerCase().includes(client))) return false;
    if (product && !((q.product?.name ?? '').toLowerCase().includes(product))) return false;
    if (incoterm && q.incoterm !== incoterm) return false;
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
        <th>Fecha</th>
        <th>Cliente</th>
        <th>País</th>
        <th>Producto</th>
        <th>Incoterm</th>
        <th>Precio/kg</th>
        <th>Precio/lb</th>
        <th>Margen%</th>
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

    tr.innerHTML = `
      <td class="quote-number">${q.quote_number ?? '—'}</td>
      <td>${dateStr}</td>
      <td>${q.client?.name ?? '—'}</td>
      <td>${q.client?.country ?? '—'}</td>
      <td>${q.product?.name ?? '—'}</td>
      <td><strong>${q.incoterm ?? '—'}</strong></td>
      <td class="num">$${(q.price_per_kg ?? 0).toFixed(2)}</td>
      <td class="num">$${(q.price_per_lb ?? 0).toFixed(2)}</td>
      <td class="num">${q.margin_pct ?? 0}%</td>
      <td><span class="status-badge ${q.status}">${q.status === 'confirmed' ? 'Confirmada' : 'Borrador'}</span></td>
      <td class="text-small text-muted">${(q.created_by ?? '').split('@')[0]}</td>
    `;

    tr.addEventListener('click', () => openDetail(q));
    tbody.appendChild(tr);
  });
}

function bindFilters() {
  ['filter-client', 'filter-product', 'filter-incoterm', 'filter-status', 'filter-user'].forEach(id => {
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

  document.getElementById('btn-copy-quote').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote.html?copy=${encodeURIComponent(activeQuote._docId)}`;
  });

  document.getElementById('btn-print-client-detail').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote.html?draft=${encodeURIComponent(activeQuote._docId)}&print=client`;
  });

  document.getElementById('btn-print-internal-detail').addEventListener('click', () => {
    if (!activeQuote) return;
    window.location.href = `quote.html?draft=${encodeURIComponent(activeQuote._docId)}&print=internal`;
  });

  document.getElementById('btn-delete-quote').addEventListener('click', async () => {
    if (!activeQuote) return;
    if (activeQuote.status === 'confirmed') {
      alert('Las cotizaciones confirmadas no se pueden eliminar.');
      return;
    }
    if (!confirm(`¿Eliminar el borrador ${activeQuote.quote_number}?`)) return;
    await deleteDoc(doc(db, 'quotes', activeQuote._docId));
    closeModal();
    await loadQuotes();
  });
}

function openDetail(q) {
  activeQuote = q;
  const brand = BRANDS[q.brand] ?? BRANDS.manila;
  document.documentElement.style.setProperty('--accent', brand.accent);
  document.documentElement.style.setProperty('--accent-light', brand.accent_light);

  document.getElementById('modal-title').textContent = `${q.quote_number} — ${q.client?.name ?? ''}`;

  // Mostrar/ocultar delete según estado
  document.getElementById('btn-delete-quote').style.display =
    q.status === 'draft' ? '' : 'none';

  const body = document.getElementById('modal-body');
  body.innerHTML = buildDetailHTML(q);

  document.getElementById('detail-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('open');
  activeQuote = null;
}

function buildDetailHTML(q) {
  const priceKg = (q.price_per_kg ?? 0).toFixed(2);
  const priceLb = (q.price_per_lb ?? 0).toFixed(2);
  const dateStr = q.created_at
    ? new Date(q.created_at).toLocaleString('es-AR')
    : '—';
  const confirmStr = q.confirmed_at
    ? new Date(q.confirmed_at).toLocaleString('es-AR')
    : '—';

  let html = `
    <div class="detail-price-block">
      <div>
        <div class="dpr-incoterm">${q.incoterm ?? ''}</div>
        <div class="dpr-kg">USD $${priceKg}/kg</div>
        <div class="dpr-lb">USD $${priceLb}/lb</div>
      </div>
      <div class="dpr-margin">Margen: ${q.margin_pct ?? 0}%</div>
    </div>

    <div class="detail-grid">
      <div class="detail-cell">
        <div class="dc-label">Cliente</div>
        <div class="dc-val">${q.client?.name ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">País</div>
        <div class="dc-val">${q.client?.country ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Contacto</div>
        <div class="dc-val">${q.client?.contact ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Producto</div>
        <div class="dc-val">${q.product?.name ?? '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Volumen</div>
        <div class="dc-val">${(q.volume_kg ?? 0).toLocaleString()} kg — ${q.num_shipments ?? 1} embarque(s)</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Rendimiento</div>
        <div class="dc-val">${q.yield_pct ?? 100}%</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Lead Time</div>
        <div class="dc-val">${q.lead_time || '—'}</div>
      </div>
      <div class="detail-cell">
        <div class="dc-label">Válida</div>
        <div class="dc-val">${q.valid_days ?? 15} días</div>
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

  // Capas de costo
  html += `<h4 style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--gray-500);margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--gray-200)">Detalle de costos — Snapshot al momento de armar la cotización</h4>`;

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
          ${item.fixed_per_shipment ? ` + $${item.fixed_per_shipment}/emb` : ''}
          ${item.fixed_per_quote ? ` + $${item.fixed_per_quote}/coti` : ''}
          → $${(item.cost_per_kg_calc ?? 0).toFixed(4)}/kg
        </span>
      </div>`;
    });
    html += `</div>`;
  });

  // Comisión
  if (q.commission) {
    const c = q.commission;
    html += `<div class="detail-cost-section">
      <h4>Comisión comercial</h4>
      <div class="detail-cost-item">
        <span class="dci-name">${c.pct}% sobre ${c.base === 'cost' ? 'costo' : 'precio venta'}</span>
        <span class="dci-val">
          ${c.fixed_per_shipment ? `+ $${c.fixed_per_shipment}/embarque ` : ''}
          ${c.fixed_per_quote ? `+ $${c.fixed_per_quote}/cotización` : ''}
        </span>
      </div>
    </div>`;
  }

  // Resumen final
  html += `<div class="detail-price-block" style="margin-top:16px">
    <div>
      <div class="dpr-incoterm">Costo total: $${(q.total_cost_per_kg ?? 0).toFixed(3)}/kg</div>
      <div class="dpr-kg">USD $${priceKg}/kg</div>
      <div class="dpr-lb">USD $${priceLb}/lb</div>
    </div>
    <div class="dpr-margin">Margen: ${q.margin_pct ?? 0}%</div>
  </div>`;

  return html;
}

init();
