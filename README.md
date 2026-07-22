# GPMD Cronometraje

Aplicativo web para cronometrar pruebas del Gran Premio Mobil Delvac a partir de CSV de puntos de cronometraje (sin decoders conectados).

## Stack

- **Backend:** Node.js + Express (TypeScript), persistencia en JSON
- **Frontend:** React + Vite (TypeScript)

## Arranque

```bash
npm run install:all
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000

## Datos

Todo se guarda en `/data`:

- `data/events/{id}.json` — eventos, puntos, pruebas, CSV parseados
- `data/pilots/pilots.json` — base de pilotos
- `data/uploads/headers/` — imagen de cabecera por evento

## Flujo

1. Crear **evento** y configurar **puntos de cronometraje** (PC A referencia, B/C/D con desfase `hh:mm:ss.xxx`)
2. Registrar **pilotos del evento** (manual o CSV con mapeo de columnas)
3. Crear **pruebas** y **partes/salidas**
4. Subir CSV por punto (o modo combinado si `Tiempo de vuelta ≠ 0`)
5. Ver resultados parciales o unificados y exportar CSV / Excel / PDF

Los pilotos viven dentro de cada evento (`data/events/{id}.json`), no en una base global.
