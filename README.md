# Minerva Timing

Aplicativo web de cronometraje para pruebas de motociclismo (CSV de puntos de control, sin decoders conectados). Marca visual **Minerva Timing**.

## Stack

- **Backend:** Node.js + Express (TypeScript), persistencia en JSON
- **Frontend:** React + Vite (TypeScript)

## Arranque

```bash
npm run install:all
npm run dev
```

| Servicio  | URL                   |
|-----------|-----------------------|
| Frontend  | http://localhost:5173 |
| API       | http://localhost:4000 |

La API escucha en todas las interfaces (`0.0.0.0`) para uso en LAN.

## Datos

Todo se guarda bajo `/data`:

- `data/events/{id}.json` — evento, contraseña, puntos, pilotos, pruebas, CSV parseados, fusiones, tablero
- `data/uploads/headers/` — imagen de cabecera por evento

Los pilotos viven **dentro de cada evento**, no en una base global.

## Flujo típico

1. Crear **evento** (contraseña obligatoria; eventos antiguos sin contraseña usan `00000`)
2. Configurar **puntos de cronometraje** (PC A = referencia, desfase `hh:mm:ss.xxx` en los demás)
3. Opcional: colores del tema (tablero / overlay) y segundos de rotación del tablero público
4. Registrar **pilotos** (alta manual o CSV con mapeo de columnas)
5. Crear **pruebas** y **partes/salidas**
6. Cargar CSV:
   - **Por punto** — un archivo por PC
   - **CSV único** — Start y Finish en el mismo archivo (1ª y 2ª pasada por Tm de pasos; “por vueltas” si aplica)
7. Calcular resultados parciales o unificados, aplicar penalizaciones, exportar CSV / Excel / PDF
8. **Publicar en tablero** (y/o fusión de pruebas) para la pantalla pública y los feeds

El panel de gestión del evento pide la contraseña; el tablero público y el overlay no.

## Modos de cronometraje (prueba)

| Modo | Uso |
|------|-----|
| **Punto a punto** | Tiempo Desde → Hasta con CSV distintos por punto |
| **Start/Finish + parcial** | 2 pasadas en SF + 1 en el parcial → sectores y total |
| **CSV único** | Un archivo por salida; Start/Finish del mismo CSV (o puntuación por vueltas) |

## Tablero público y transmisión

| Recurso | Ruta |
|---------|------|
| Tablero | `/tablero/{eventId}` |
| Overlay (OBS/vMix) | `/overlay/{eventId}` |
| Feed JSON | `/api/events/{eventId}/board/feed.json` |
| Feed CSV | `/api/events/{eventId}/board/feed.csv` |
| Feed XML | `/api/events/{eventId}/board/feed.xml` |

En el **tablero** (no el overlay):

- Resultados publicados, paginados de **10 en 10**
- Rotación automática según **segundos** configurados en el evento (3–120, default 10)
- Columnas de **penalización** (tiempo, posición, comentario) cuando aplica
- La columna **Categoría** solo se muestra si algún piloto la tiene

Parámetros útiles del overlay: `?section=2`, `top=20`, `refresh=5`, `gap=0`, `header=0`. En los feeds, `?section=2` filtra una sección.

El JSON del feed incluye tiempos con y sin penalización (`time`, `rawTime`, `timePenaltyMs`, `positionPenalty`, `comment`, `hasPenalty`).

## Otras funciones del panel

- Búsqueda de pilotos por **número o nombre** (sin tildes ni mayúsculas) en la base del evento y en resultados de cada prueba
- **Fusión** de tiempos unificados entre varias pruebas
- Exportaciones PDF con cabecera, pie y descripción de prueba opcional

## Estructura

```
backend/     API Express
frontend/    UI React (Vite)
data/        Persistencia local (no versionar secretos de producción)
```

## Scripts

```bash
npm run install:all   # dependencias backend + frontend
npm run dev           # ambos en paralelo
npm run dev:backend
npm run dev:frontend
```
