# Frontend Vehículo IoT

Aplicación web estática para las prácticas 4.1 (control) y 4.2 (monitoreo). No requiere Node.js ni dependencias de frontend.

## Archivos
- `index.html`: estructura de la interfaz.
- `styles.css`: diseño adaptable a móvil y escritorio.
- `app.js`: consumo de API REST y WebSocket.

## Ejecución local
1. Inicia FastAPI desde la carpeta raíz del proyecto:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
2. Abre `frontend/index.html` mediante un servidor estático (por ejemplo, extensión Live Server de VS Code o `python -m http.server 5500` dentro de `frontend`).
3. En Configuración, escribe `http://127.0.0.1:8000` si el navegador y FastAPI están en la misma computadora. Si accedes desde un celular, usa la IP local de la computadora que ejecuta FastAPI.
4. La aplicación consulta `/health`, carga `/api/vehiculos` y solicita los comandos, estado, historial y demostraciones del vehículo seleccionado.

## Publicación en GitHub Pages
Publica el contenido de `frontend/` como sitio estático. La URL del backend debe ser pública y accesible por HTTPS. El navegador utilizará WSS automáticamente cuando la API use HTTPS. GitHub Pages no aloja FastAPI ni conecta directamente con Amazon RDS.

## Compatibilidad con la API actual
Se utilizan las rutas existentes:
- `GET /health`
- `GET /api/vehiculos`
- `GET /api/vehiculos/{id}/comandos`
- `GET /api/vehiculos/{id}/estado`
- `POST /api/historial`
- `GET /api/vehiculos/{id}/historial?limite=10`
- `GET /api/vehiculos/{id}/demos`
- `GET /api/demos/{id}/movimientos`
- `WS /ws/{id}`

**Importante sobre el hardware:** el WebSocket actual acepta mensajes y los retransmite a los clientes conectados al mismo vehículo; no existe todavía un consumidor que traduzca esos mensajes a instrucciones del microcontrolador. Por eso, el panel implementa la comunicación y la emisión de eventos, pero no se debe afirmar que el vehículo físico se mueve hasta integrar y probar ese puente.

## Seguridad
- No publiques `.env`, contraseñas de RDS ni tokens en GitHub Pages.
- Usa HTTPS/WSS en despliegue.
- Restringe CORS a los dominios de confianza antes de publicar el backend en producción.
