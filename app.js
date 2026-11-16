(() => {
  const $ = (id) => document.getElementById(id);
  const state = { api: '', vehicleId: '', vehicles: [], commands: [], demos: [], ws: null, wsReady: false, polling: null, busyDemo: false, lastEvent: null };
  const api = (path) => `${state.api.replace(/\/$/, '')}${path}`;
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const toast = (message) => { const el = $('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3200); };
  const setConnection = (online, label) => {
    $('apiStatus').innerHTML = `<i class="status-dot ${online ? 'online' : ''}"></i><span>${online ? 'API conectada' : 'API desconectada'}</span>`;
    $('sideDot').classList.toggle('online', online); $('sideConnection').textContent = label || (online ? 'API disponible' : 'Sin conectar');
  };
  
async function request(path, options = {}) {
    if (!state.api) {
        throw new Error('Configura primero la URL de tu API.');
    }

    const headers = {
        ...(options.headers || {})
    };

    // Solo agregar Content-Type cuando se envía un cuerpo JSON.
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(api(path), {
        ...options,
        headers
    });

    const text = await response.text();
    let data = null;

    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }

    if (!response.ok) {
        throw new Error(
            data?.detail || data?.mensaje || `Error HTTP ${response.status}`
        );
    }

    return data;
}

  function selectedVehicle() { return state.vehicles.find(v => Number(v.id_vehiculo ?? v.id) === Number(state.vehicleId)); }
  function commandFor(direction) {
    const aliases = { adelante: ['adelante','avanzar','frente','forward'], atras: ['atras','retroceder','reversa','reverse'], izquierda: ['izquierda','left','girar izq'], derecha: ['derecha','right','girar der'], detener: ['detener','paro','stop','alto'] };
    return state.commands.find(c => aliases[direction]?.some(a => normalize(c.nombre).includes(normalize(a))));
  }
  async function loadVehicles() {
    const data = await request('/api/vehiculos'); state.vehicles = Array.isArray(data) ? data : (data?.resultado || []);
    const select = $('vehicleSelect'); select.innerHTML = '';
    if (!state.vehicles.length) { select.innerHTML = '<option value="">No hay vehículos registrados</option>'; return; }
    state.vehicles.forEach(v => { const id = v.id_vehiculo ?? v.id; const option = document.createElement('option'); option.value = id; option.textContent = v.nombre ? `${v.nombre} · #${id}` : `Vehículo #${id}`; select.append(option); });
    const wanted = state.vehicleId || localStorage.getItem('iot_vehicle_id');
    state.vehicleId = state.vehicles.some(v => String(v.id_vehiculo ?? v.id) === String(wanted)) ? String(wanted) : String(state.vehicles[0].id_vehiculo ?? state.vehicles[0].id);
    select.value = state.vehicleId; localStorage.setItem('iot_vehicle_id', state.vehicleId);
  }
  async function loadCommands() {
    const data = await request(`/api/vehiculos/${state.vehicleId}/comandos`); state.commands = Array.isArray(data) ? data : (data?.resultado || []);
    $('commandCount').textContent = state.commands.length; $('quickCount').textContent = state.commands.length;
    const host = $('quickCommands'); host.innerHTML = '';
    if (!state.commands.length) { host.innerHTML = '<div class="empty-state">Este vehículo no tiene comandos registrados.</div>'; return; }
    state.commands.forEach((c, index) => {
      const name = c.nombre || `Comando ${index + 1}`; const code = c.codigo ?? '—';
      const btn = document.createElement('button'); btn.className = 'quick-command'; btn.innerHTML = `<span class="command-symbol">${symbolFor(name)}</span><b>${escapeHtml(name)}</b><small>Código: ${escapeHtml(code)}</small>`;
      btn.addEventListener('click', () => sendCommand(c, 'COMANDO_RAPIDO')); host.append(btn);
    });
  }
  function symbolFor(name) { const n = normalize(name); if (n.includes('adel') || n.includes('avanz') || n.includes('forward')) return '↑'; if (n.includes('atras') || n.includes('retro') || n.includes('reverse')) return '↓'; if (n.includes('izq') || n.includes('left')) return '←'; if (n.includes('der') || n.includes('right')) return '→'; if (n.includes('stop') || n.includes('deten') || n.includes('paro')) return '■'; return '⌁'; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function connectWs() {
    if (state.ws) { state.ws.onclose = null; state.ws.close(); }
    state.wsReady = false; $('wsState').textContent = 'Conectando'; $('wsHint').textContent = 'Abriendo canal en tiempo real';
    if (!state.api || !state.vehicleId) return;
    const url = new URL(api(`/ws/vehiculos/${state.vehicleId}`)); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    try { const ws = new WebSocket(url); state.ws = ws;
      ws.onopen = () => { state.wsReady = true; $('wsState').textContent = 'Online'; $('wsHint').textContent = 'Canal activo'; toast('WebSocket conectado.'); };
      ws.onmessage = (event) => { let data; try { data = JSON.parse(event.data); } catch { data = { datos: event.data }; } state.lastEvent = data; $('lastCommand').textContent = data.mensaje || data.direccion || data.tipo || 'Evento recibido'; $('eventCount').textContent = String(Math.max(Number($('eventCount').textContent) || 0, 1)); };
      ws.onerror = () => { $('wsHint').textContent = 'No se pudo establecer el canal'; };
      ws.onclose = () => { state.wsReady = false; $('wsState').textContent = 'Offline'; $('wsHint').textContent = 'Canal desconectado'; };
    } catch (e) { $('wsState').textContent = 'Error'; $('wsHint').textContent = e.message; }
  }
  async function sendPayload(payload, command = null, origin = 'JOYSTICK') {
    if (!state.wsReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) { toast('WebSocket desconectado. Revisa la URL y el backend.'); return false; }
    const message = { id_vehiculo: Number(state.vehicleId), ...payload, origen: origin, timestamp: new Date().toISOString() };
    state.ws.send(JSON.stringify(message));
    $('lastCommand').textContent = payload.nombre || payload.direccion || payload.accion || 'Instrucción enviada';
    if (command?.id_comando || command?.id) {
      try { await request('/api/historial', { method: 'POST', body: JSON.stringify({ id_vehiculo: Number(state.vehicleId), id_comando: Number(command.id_comando ?? command.id), origen: origin }) }); } catch (e) { toast(`Evento enviado; historial: ${e.message}`); }
    }
    return true;
  }
  async function sendCommand(command, origin = 'COMANDO_RAPIDO') {
    const payload = { tipo: 'comando', accion: 'ejecutar_comando', id_comando: command.id_comando ?? command.id, nombre: command.nombre, codigo: command.codigo };
    if (await sendPayload(payload, command, origin)) toast(`Comando «${command.nombre}» enviado.`);
  }
  async function move(direction) {
    const speed = Number($('speedRange').value); const command = commandFor(direction);
    await sendPayload({ tipo: 'movimiento', accion: 'movimiento', direccion: direction, velocidad: speed, ...(command ? { id_comando: command.id_comando ?? command.id, codigo: command.codigo } : {}) }, command, 'JOYSTICK');
    $('controlFeedback').textContent = `Instrucción enviada: ${direction} · velocidad ${speed}%`;
  }
  async function stopVehicle() {
    const command = commandFor('detener');
    await sendPayload({ tipo: 'movimiento', accion: 'detener', direccion: 'detener', velocidad: 0, ...(command ? { id_comando: command.id_comando ?? command.id, codigo: command.codigo } : {}) }, command, 'JOYSTICK');
    $('controlFeedback').textContent = 'Instrucción de detención enviada.';
  }
  async function loadStatus() {
    try {
      const data = await request('/health'); setConnection(true, 'API disponible');
      if (state.vehicleId) {
        try { const s = await request(`/api/vehiculos/${state.vehicleId}/estado`); const connected = s.conectado ?? s.estado_conexion ?? s.estado; $('vehicleState').textContent = typeof connected === 'boolean' ? (connected ? 'Conectado' : 'Desconectado') : (connected ?? 'Disponible'); $('vehicleStateHint').textContent = `Vehículo #${state.vehicleId}`; } catch { $('vehicleState').textContent = 'Sin datos'; $('vehicleStateHint').textContent = 'No se pudo consultar el estado'; }
      }
      return data;
    } catch (e) { setConnection(false, 'API sin conexión'); $('vehicleState').textContent = '—'; throw e; }
  }
  function formatDate(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); }
  async function loadHistory() {
    const data = await request(`/api/vehiculos/${state.vehicleId}/historial?limite=10`); const rows = Array.isArray(data) ? data : (data?.resultado || []); $('eventCount').textContent = rows.length;
    const body = $('historyBody'); body.innerHTML = '';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="empty-cell">Todavía no hay eventos registrados.</td></tr>'; $('historySummary').textContent = '0 registros'; return; }
    rows.forEach((r, i) => { const tr = document.createElement('tr'); const date = r.fecha_hora ?? r.fecha ?? r.created_at ?? r.fecha_registro; const name = r.nombre_comando ?? r.comando ?? r.nombre ?? (r.id_comando ? `Comando #${r.id_comando}` : 'Evento'); const origin = r.origen ?? '—'; tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(r.codigo ?? r.id_comando ?? '—')}</td><td><span class="origin-tag">${escapeHtml(origin)}</span></td><td>${escapeHtml(formatDate(date))}</td>`; body.append(tr); });
    $('historySummary').textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'} mostrados`;
  }
  async function loadDemos() {
    const data = await request(`/api/vehiculos/${state.vehicleId}/demos`); state.demos = Array.isArray(data) ? data : (data?.resultado || []); const host = $('demoList'); host.innerHTML = '';
    if (!state.demos.length) { host.innerHTML = '<div class="empty-state">No hay demostraciones registradas para este vehículo.</div>'; return; }
    state.demos.forEach(d => { const id = d.id_demo ?? d.id; const item = document.createElement('div'); item.className = 'demo-item'; item.innerHTML = `<div><b>${escapeHtml(d.nombre || `Demostración #${id}`)}</b><small>${escapeHtml(d.descripcion || 'Secuencia de movimientos')}</small></div><div class="demo-actions"><button class="play-button" data-demo="${escapeHtml(id)}">▶ Ejecutar</button></div>`; item.querySelector('button').addEventListener('click', () => playDemo(d)); host.append(item); });
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function playDemo(demo) {
    if (state.busyDemo) return; state.busyDemo = true;
    try {
      const id = demo.id_demo ?? demo.id; const moves = await request(`/api/demos/${id}/movimientos`); const list = Array.isArray(moves) ? moves : (moves?.resultado || []);
      if (!list.length) { toast('Esta demostración no tiene movimientos.'); return; }
      list.sort((a,b) => Number(a.orden) - Number(b.orden)); toast(`Iniciando: ${demo.nombre}`);
      for (const move of list) {
        const command = state.commands.find(c => Number(c.id_comando ?? c.id) === Number(move.id_comando));
        if (!command) { toast(`No se encontró el comando ${move.id_comando}.`); continue; }
        await sendPayload({ tipo: 'demo', accion: 'ejecutar_movimiento_demo', id_demo: id, orden: move.orden, duracion_ms: move.duracion_ms, pausa_ms: move.pausa_ms, id_comando: move.id_comando, codigo: command.codigo, nombre: command.nombre }, command, 'DEMO');
        await sleep(Number(move.duracion_ms || 0) + Number(move.pausa_ms || 0));
      }
      toast('Secuencia enviada por WebSocket.');
    } catch (e) { toast(`No se pudo ejecutar la demostración: ${e.message}`); }
    finally { state.busyDemo = false; }
  }
  async function refreshAll() {
    if (!state.api) { $('settingsDialog').showModal(); return; }
    try { await loadStatus(); if (!state.vehicleId) await loadVehicles(); if (state.vehicleId) { await Promise.allSettled([loadCommands(), loadHistory(), loadDemos()]); } }
    catch (e) { toast(e.message); }
  }
  async function changeVehicle() { state.vehicleId = $('vehicleSelect').value; localStorage.setItem('iot_vehicle_id', state.vehicleId); connectWs(); try { await Promise.allSettled([loadCommands(), loadHistory(), loadDemos(), loadStatus()]); } catch (e) { toast(e.message); } }
  function setupJoystick() {
    document.querySelectorAll('[data-direction]').forEach(btn => {
      const direction = btn.dataset.direction; let timer = null;
      const start = e => { e.preventDefault(); btn.classList.add('pressed'); move(direction); timer = setInterval(() => move(direction), 650); };
      const end = () => { btn.classList.remove('pressed'); if (timer) clearInterval(timer); timer = null; };
      btn.addEventListener('pointerdown', start); ['pointerup','pointerleave','pointercancel'].forEach(ev => btn.addEventListener(ev, end));
    });
  }
  $('speedRange').addEventListener('input', e => $('speedValue').textContent = e.target.value);
  $('stopBtn').addEventListener('click', stopVehicle); $('vehicleSelect').addEventListener('change', changeVehicle);
  $('refreshBtn').addEventListener('click', refreshAll); $('reloadHistory').addEventListener('click', () => loadHistory().catch(e => toast(e.message))); $('reloadDemos').addEventListener('click', () => loadDemos().catch(e => toast(e.message)));
  $('openSettings').addEventListener('click', () => { $('apiUrl').value = state.api; $('vehicleIdInput').value = state.vehicleId; $('settingsDialog').showModal(); });
  $('settingsForm').addEventListener('submit', async e => { e.preventDefault(); state.api = $('apiUrl').value.trim().replace(/\/$/, ''); state.vehicleId = $('vehicleIdInput').value.trim(); localStorage.setItem('iot_api_url', state.api); if (state.vehicleId) localStorage.setItem('iot_vehicle_id', state.vehicleId); $('settingsDialog').close(); await initialize(); });
  async function initialize() {
    if (!state.api) { $('settingsDialog').showModal(); return; }
    try { await loadStatus(); await loadVehicles(); if (state.vehicleId) { await Promise.allSettled([loadCommands(), loadHistory(), loadDemos()]); connectWs(); } }
    catch (e) { toast(`No se pudo conectar: ${e.message}`); $('settingsDialog').showModal(); }
    if (state.polling) clearInterval(state.polling); state.polling = setInterval(async () => { if (!state.api || !state.vehicleId) return; try { await loadStatus(); await loadHistory(); } catch {} }, 8000);
  }
  setupJoystick(); state.api = localStorage.getItem('iot_api_url') || ''; state.vehicleId = localStorage.getItem('iot_vehicle_id') || ''; if (state.api) initialize(); else $('settingsDialog').showModal();
})();
