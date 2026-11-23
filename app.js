(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    api: '',
    vehicleId: '',
    vehicles: [],
    commands: [],
    demos: [],
    ws: null,
    wsReady: false,
    polling: null,
    busyDemo: false,
    lastEvent: null,
  };

  const api = (path) => `${state.api.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

  const normalize = (value) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  let toastTimer = null;
  const toast = (message) => {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  };

  const setConnection = (online, label) => {
    const apiStatus = $('apiStatus');
    const sideDot = $('sideDot');
    const sideConnection = $('sideConnection');

    if (apiStatus) {
      apiStatus.innerHTML = `<i class="status-dot ${online ? 'online' : ''}"></i><span>${online ? 'API conectada' : 'API desconectada'}</span>`;
    }
    if (sideDot) sideDot.classList.toggle('online', online);
    if (sideConnection) sideConnection.textContent = label || (online ? 'API disponible' : 'Sin conectar');
  };

  const extractList = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.resultado)) return data.resultado;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };

  const getVehicleId = (v) => v?.id_vehiculo ?? v?.id ?? '';
  const getCommandId = (c) => c?.id_comando ?? c?.id ?? '';
  const getDemoId = (d) => d?.id_demo ?? d?.id ?? '';

  function validateApiUrl(rawUrl) {
    const cleaned = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!cleaned) return { ok: false, url: '', error: 'Ingresa la URL de tu API.' };

    let parsed;
    try {
      parsed = new URL(cleaned);
    } catch {
      return { ok: false, url: cleaned, error: 'La URL de la API no es válida.' };
    }

    if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
      return {
        ok: false,
        url: cleaned,
        error: 'En HTTPS no puedes usar una URL http:// (Mixed Content). Usa una URL https://.',
      };
    }

    return { ok: true, url: cleaned, error: null };
  }

  async function request(path, options = {}) {
    if (!state.api) {
      throw new Error('Configura primero la URL de tu API.');
    }

    const headers = {
      ...(options.headers || {}),
    };

    const hasBody = options.body !== undefined && options.body !== null;
    if (hasBody && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(api(path), {
      ...options,
      headers,
    });

    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const detail =
        (typeof data === 'object' && data !== null && (data.detail || data.mensaje || data.message)) ||
        `Error HTTP ${response.status}`;
      throw new Error(detail);
    }

    return data;
  }

  function selectedVehicle() {
    return state.vehicles.find((v) => String(getVehicleId(v)) === String(state.vehicleId));
  }

  function commandFor(direction) {
    const aliases = {
      adelante: ['adelante', 'avanzar', 'frente', 'forward'],
      atras: ['atras', 'retroceder', 'reversa', 'reverse'],
      izquierda: ['izquierda', 'left', 'girar izq'],
      derecha: ['derecha', 'right', 'girar der'],
      detener: ['detener', 'paro', 'stop', 'alto'],
    };

    const targetAliases = aliases[direction] || [];
    return state.commands.find((c) => {
      const normName = normalize(c.nombre);
      return targetAliases.some((a) => normName.includes(normalize(a)));
    });
  }

  async function loadVehicles() {
    const data = await request('/api/vehiculos');
    state.vehicles = extractList(data);

    const select = $('vehicleSelect');
    if (!select) return;

    select.innerHTML = '';
    if (!state.vehicles.length) {
      select.innerHTML = '<option value="">No hay vehículos registrados</option>';
      state.vehicleId = '';
      localStorage.removeItem('iot_vehicle_id');
      return;
    }

    state.vehicles.forEach((v) => {
      const id = String(getVehicleId(v));
      const option = document.createElement('option');
      option.value = id;
      option.textContent = v.nombre ? `${v.nombre} · #${id}` : `Vehículo #${id}`;
      select.append(option);
    });

    const wanted = state.vehicleId || localStorage.getItem('iot_vehicle_id') || '';
    const exists = state.vehicles.some((v) => String(getVehicleId(v)) === String(wanted));
    state.vehicleId = exists ? String(wanted) : String(getVehicleId(state.vehicles[0]));

    select.value = state.vehicleId;
    localStorage.setItem('iot_vehicle_id', state.vehicleId);
  }

  function symbolFor(name) {
    const n = normalize(name);
    if (n.includes('adel') || n.includes('avanz') || n.includes('forward')) return '↑';
    if (n.includes('atras') || n.includes('retro') || n.includes('reverse')) return '↓';
    if (n.includes('izq') || n.includes('left')) return '←';
    if (n.includes('der') || n.includes('right')) return '→';
    if (n.includes('stop') || n.includes('deten') || n.includes('paro')) return '■';
    return '⌁';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  async function loadCommands() {
    if (!state.vehicleId) return;
    const data = await request(`/api/vehiculos/${encodeURIComponent(state.vehicleId)}/comandos`);
    state.commands = extractList(data);

    if ($('commandCount')) $('commandCount').textContent = state.commands.length;
    if ($('quickCount')) $('quickCount').textContent = state.commands.length;

    const host = $('quickCommands');
    if (!host) return;
    host.innerHTML = '';

    if (!state.commands.length) {
      host.innerHTML = '<div class="empty-state">Este vehículo no tiene comandos registrados.</div>';
      return;
    }

    state.commands.forEach((c, index) => {
      const name = c.nombre || `Comando ${index + 1}`;
      const code = c.codigo ?? '—';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-command';
      btn.innerHTML = `<span class="command-symbol">${symbolFor(name)}</span><b>${escapeHtml(name)}</b><small>Código: ${escapeHtml(code)}</small>`;
      btn.addEventListener('click', () => sendCommand(c, 'COMANDO_RAPIDO'));
      host.append(btn);
    });
  }

  function connectWs() {
    if (state.ws) {
      state.ws.onopen = null;
      state.ws.onmessage = null;
      state.ws.onerror = null;
      state.ws.onclose = null;
      if (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING) {
        state.ws.close();
      }
      state.ws = null;
    }

    state.wsReady = false;
    if ($('wsState')) $('wsState').textContent = 'Conectando';
    if ($('wsHint')) $('wsHint').textContent = 'Abriendo canal en tiempo real';

    if (!state.api || !state.vehicleId) {
      if ($('wsState')) $('wsState').textContent = 'Offline';
      if ($('wsHint')) $('wsHint').textContent = 'Falta API o vehículo';
      return;
    }

    let url;
    try {
      url = new URL(api(`/ws/vehiculos/${encodeURIComponent(state.vehicleId)}`));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    } catch (e) {
      if ($('wsState')) $('wsState').textContent = 'Error';
      if ($('wsHint')) $('wsHint').textContent = e.message;
      return;
    }

    try {
      const ws = new WebSocket(url.toString());
      state.ws = ws;

      ws.onopen = () => {
        if (state.ws !== ws) return;
        state.wsReady = true;
        if ($('wsState')) $('wsState').textContent = 'Online';
        if ($('wsHint')) $('wsHint').textContent = 'Canal activo';
        toast('WebSocket conectado.');
      };

      ws.onmessage = (event) => {
        if (state.ws !== ws) return;
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          data = { datos: event.data };
        }
        state.lastEvent = data;
        if ($('lastCommand')) {
          $('lastCommand').textContent = data?.mensaje || data?.direccion || data?.tipo || 'Evento recibido';
        }
        if ($('eventCount')) {
          const current = Number($('eventCount').textContent) || 0;
          $('eventCount').textContent = String(Math.max(current, 1));
        }
      };

      ws.onerror = () => {
        if (state.ws !== ws) return;
        if ($('wsHint')) $('wsHint').textContent = 'No se pudo establecer el canal';
      };

      ws.onclose = () => {
        if (state.ws !== ws) return;
        state.wsReady = false;
        if ($('wsState')) $('wsState').textContent = 'Offline';
        if ($('wsHint')) $('wsHint').textContent = 'Canal desconectado';
      };
    } catch (e) {
      if ($('wsState')) $('wsState').textContent = 'Error';
      if ($('wsHint')) $('wsHint').textContent = e.message;
    }
  }

  async function sendPayload(payload, command = null, origin = 'JOYSTICK') {
    const vehicleNum = Number(state.vehicleId);
    if (!vehicleNum) {
      toast('Selecciona un vehículo primero.');
      return false;
    }

    const message = {
      id_vehiculo: vehicleNum,
      ...payload,
      origen: origin,
      timestamp: new Date().toISOString(),
    };

    const wsOpen = state.ws && state.ws.readyState === WebSocket.OPEN;
    if (!wsOpen) {
      toast('WebSocket desconectado. Revisa la conexión o el backend.');
      return false;
    }

    state.ws.send(JSON.stringify(message));
    if ($('lastCommand')) {
      $('lastCommand').textContent = payload.nombre || payload.direccion || payload.accion || 'Instrucción enviada';
    }

    const commandId = Number(getCommandId(command));
    if (commandId) {
      try {
        await request('/api/historial', {
          method: 'POST',
          body: JSON.stringify({
            id_vehiculo: vehicleNum,
            id_comando: commandId,
            origen: origin,
          }),
        });
      } catch (e) {
        toast(`Enviado por WS; historial no guardado: ${e.message}`);
      }
    }

    return true;
  }

  async function sendCommand(command, origin = 'COMANDO_RAPIDO') {
    const payload = {
      tipo: 'comando',
      accion: 'ejecutar_comando',
      id_comando: getCommandId(command),
      nombre: command.nombre,
      codigo: command.codigo,
    };

    const sent = await sendPayload(payload, command, origin);
    if (sent) toast(`Comando «${command.nombre}» enviado.`);
  }

  async function move(direction) {
    const speed = Number($('speedRange')?.value ?? 0);
    const command = commandFor(direction);
    const cmdId = getCommandId(command);

    const sent = await sendPayload(
      {
        tipo: 'movimiento',
        accion: 'movimiento',
        direccion,
        velocidad: speed,
        ...(cmdId ? { id_comando: cmdId, codigo: command.codigo } : {}),
      },
      command,
      'JOYSTICK'
    );

    if (sent && $('controlFeedback')) {
      $('controlFeedback').textContent = `Instrucción enviada: ${direction} · velocidad ${speed}%`;
    }
  }

  async function stopVehicle() {
    const command = commandFor('detener');
    const cmdId = getCommandId(command);

    const sent = await sendPayload(
      {
        tipo: 'movimiento',
        accion: 'detener',
        direccion: 'detener',
        velocidad: 0,
        ...(cmdId ? { id_comando: cmdId, codigo: command.codigo } : {}),
      },
      command,
      'JOYSTICK'
    );

    if (sent && $('controlFeedback')) {
      $('controlFeedback').textContent = 'Instrucción de detención enviada.';
    }
  }

  async function loadStatus() {
    try {
      const data = await request('/health');
      setConnection(true, 'API disponible');

      if (state.vehicleId) {
        try {
          const s = await request(`/api/vehiculos/${encodeURIComponent(state.vehicleId)}/estado`);
          const connected = s?.conectado ?? s?.estado_conexion ?? s?.estado;
          if ($('vehicleState')) {
            $('vehicleState').textContent =
              typeof connected === 'boolean'
                ? connected
                  ? 'Conectado'
                  : 'Desconectado'
                : connected ?? 'Disponible';
          }
          if ($('vehicleStateHint')) {
            $('vehicleStateHint').textContent = `Vehículo #${state.vehicleId}`;
          }
        } catch {
          if ($('vehicleState')) $('vehicleState').textContent = 'Sin datos';
          if ($('vehicleStateHint')) $('vehicleStateHint').textContent = 'No se pudo consultar el estado';
        }
      }

      return data;
    } catch (e) {
      setConnection(false, 'API sin conexión');
      if ($('vehicleState')) $('vehicleState').textContent = '—';
      throw e;
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? String(value)
      : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function loadHistory() {
    if (!state.vehicleId) return;
    const data = await request(`/api/vehiculos/${encodeURIComponent(state.vehicleId)}/historial?limite=10`);
    const rows = extractList(data);

    if ($('eventCount')) $('eventCount').textContent = rows.length;

    const body = $('historyBody');
    if (!body) return;
    body.innerHTML = '';

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-cell">Todavía no hay eventos registrados.</td></tr>';
      if ($('historySummary')) $('historySummary').textContent = '0 registros';
      return;
    }

    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const date = r.fecha_hora ?? r.fecha ?? r.created_at ?? r.fecha_registro;
      const name =
        r.nombre_comando ??
        r.comando ??
        r.nombre ??
        (r.id_comando ? `Comando #${r.id_comando}` : 'Evento');
      const origin = r.origen ?? '—';

      tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${escapeHtml(r.codigo ?? r.id_comando ?? '—')}</td><td><span class="origin-tag">${escapeHtml(origin)}</span></td><td>${escapeHtml(formatDate(date))}</td>`;
      body.append(tr);
    });

    if ($('historySummary')) {
      $('historySummary').textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'} mostrados`;
    }
  }

  async function loadDemos() {
    if (!state.vehicleId) return;
    const data = await request(`/api/vehiculos/${encodeURIComponent(state.vehicleId)}/demos`);
    state.demos = extractList(data);

    const host = $('demoList');
    if (!host) return;
    host.innerHTML = '';

    if (!state.demos.length) {
      host.innerHTML = '<div class="empty-state">No hay demostraciones registradas para este vehículo.</div>';
      return;
    }

    state.demos.forEach((d) => {
      const id = getDemoId(d);
      const item = document.createElement('div');
      item.className = 'demo-item';
      item.innerHTML = `<div><b>${escapeHtml(d.nombre || `Demostración #${id}`)}</b><small>${escapeHtml(d.descripcion || 'Secuencia de movimientos')}</small></div><div class="demo-actions"><button type="button" class="play-button" data-demo="${escapeHtml(id)}">▶ Ejecutar</button></div>`;
      item.querySelector('button')?.addEventListener('click', () => playDemo(d));
      host.append(item);
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

  async function playDemo(demo) {
    if (state.busyDemo) return;
    state.busyDemo = true;

    try {
      const id = getDemoId(demo);
      const movesData = await request(`/api/demos/${encodeURIComponent(id)}/movimientos`);
      const list = [...extractList(movesData)];

      if (!list.length) {
        toast('Esta demostración no tiene movimientos.');
        return;
      }

      list.sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0));
      toast(`Iniciando: ${demo.nombre || `Demostración #${id}`}`);

      for (const step of list) {
        const command = state.commands.find(
          (c) => String(getCommandId(c)) === String(step.id_comando)
        );
        if (!command) {
          toast(`No se encontró el comando ${step.id_comando}.`);
          continue;
        }

        await sendPayload(
          {
            tipo: 'demo',
            accion: 'ejecutar_movimiento_demo',
            id_demo: id,
            orden: step.orden,
            duracion_ms: step.duracion_ms,
            pausa_ms: step.pausa_ms,
            id_comando: step.id_comando,
            codigo: command.codigo,
            nombre: command.nombre,
          },
          command,
          'DEMO'
        );

        await sleep(Number(step.duracion_ms || 0) + Number(step.pausa_ms || 0));
      }

      toast('Secuencia enviada por WebSocket.');
    } catch (e) {
      toast(`No se pudo ejecutar la demostración: ${e.message}`);
    } finally {
      state.busyDemo = false;
    }
  }

  async function refreshAll() {
    if (!state.api) {
      $('settingsDialog')?.showModal();
      return;
    }
    try {
      await loadStatus();
      if (!state.vehicleId) await loadVehicles();
      if (state.vehicleId) {
        await Promise.allSettled([loadCommands(), loadHistory(), loadDemos()]);
        if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
          connectWs();
        }
      }
    } catch (e) {
      toast(e.message);
    }
  }

  async function changeVehicle() {
    const select = $('vehicleSelect');
    if (!select) return;
    state.vehicleId = select.value;
    if (state.vehicleId) {
      localStorage.setItem('iot_vehicle_id', state.vehicleId);
    } else {
      localStorage.removeItem('iot_vehicle_id');
    }
    connectWs();
    try {
      await Promise.allSettled([loadCommands(), loadHistory(), loadDemos(), loadStatus()]);
    } catch (e) {
      toast(e.message);
    }
  }

  function setupJoystick() {
    document.querySelectorAll('[data-direction]').forEach((btn) => {
      const direction = btn.dataset.direction;
      let timer = null;

      const stopRepeat = () => {
        btn.classList.remove('pressed');
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      };

      const start = (e) => {
        e.preventDefault();
        stopRepeat();
        btn.classList.add('pressed');
        move(direction);
        timer = setInterval(() => move(direction), 650);
      };

      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', stopRepeat);
      btn.addEventListener('pointerleave', stopRepeat);
      btn.addEventListener('pointercancel', stopRepeat);
      window.addEventListener('pointerup', stopRepeat);
      window.addEventListener('blur', stopRepeat);
    });
  }

  $('speedRange')?.addEventListener('input', (e) => {
    if ($('speedValue')) $('speedValue').textContent = e.target.value;
  });

  $('stopBtn')?.addEventListener('click', stopVehicle);
  $('vehicleSelect')?.addEventListener('change', changeVehicle);
  $('refreshBtn')?.addEventListener('click', refreshAll);
  $('reloadHistory')?.addEventListener('click', () => loadHistory().catch((e) => toast(e.message)));
  $('reloadDemos')?.addEventListener('click', () => loadDemos().catch((e) => toast(e.message)));

  $('openSettings')?.addEventListener('click', () => {
    if ($('apiUrl')) $('apiUrl').value = state.api;
    if ($('vehicleIdInput')) $('vehicleIdInput').value = state.vehicleId;
    $('settingsDialog')?.showModal();
  });

  $('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = $('apiUrl')?.value ?? '';
    const check = validateApiUrl(rawUrl);
    if (!check.ok) {
      toast(check.error);
      return;
    }

    state.api = check.url;
    state.vehicleId = ($('vehicleIdInput')?.value ?? '').trim();

    localStorage.setItem('iot_api_url', state.api);
    if (state.vehicleId) {
      localStorage.setItem('iot_vehicle_id', state.vehicleId);
    } else {
      localStorage.removeItem('iot_vehicle_id');
    }

    $('settingsDialog')?.close();
    await initialize();
  });

  async function initialize() {
    const check = validateApiUrl(state.api);
    if (!check.ok) {
      if (state.api) toast(check.error);
      $('settingsDialog')?.showModal();
      return;
    }
    state.api = check.url;

    try {
      await loadStatus();
      await loadVehicles();
      if (state.vehicleId) {
        await Promise.allSettled([loadCommands(), loadHistory(), loadDemos()]);
        connectWs();
      }
    } catch (e) {
      toast(`No se pudo conectar: ${e.message}`);
      $('settingsDialog')?.showModal();
    }

    if (state.polling) clearInterval(state.polling);
    state.polling = setInterval(async () => {
      if (!state.api || !state.vehicleId) return;
      try {
        await loadStatus();
        await loadHistory();
      } catch {
        // Error silencioso en polling para no saturar con toasts
      }
    }, 8000);
  }

  setupJoystick();

  const savedApi = localStorage.getItem('iot_api_url') || '';
  const savedVehicle = localStorage.getItem('iot_vehicle_id') || '';
  state.api = savedApi;
  state.vehicleId = savedVehicle;

  if (state.api) {
    initialize();
  } else {
    $('settingsDialog')?.showModal();
  }
})();
