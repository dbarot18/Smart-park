# 🅿 ParkSmart USA
### OpenStreetMap parking — honest, map-based data

This app shows **real mapped parking features** from **OpenStreetMap** (via Overpass). It displays **only what mappers recorded** (location, `fee`, `capacity`, hours, operator, etc.). It does **not** invent per-bay occupancy, “live free counts,” or bookings.

**For true production** (real-time spaces), you need a **backend + operator/sensor API** — see `CONFIG.OCCUPANCY_API_URL` in `js/config.js` (placeholder for your future service).

---

## 📁 Project Structure

```
parksmart/
├── index.html
├── css/          ← layout, components, map panel, animations
├── js/
│   ├── config.js ← API URLs, optional Mapbox token, optional occupancy API stub
│   ├── utils.js
│   ├── api.js    ← Geocoding + Overpass + parseLots (OSM tags only)
│   ├── map.js    ← Leaflet / Mapbox markers
│   ├── ui.js     ← Sidebar, detail panel, toasts
│   └── app.js    ← Controller
└── README.md
```

---

## 🚀 Quick Start

1. Serve the folder (`npx serve .`) and open the URL.
2. The map loads immediately (Leaflet + dark tiles by default).
3. Search a US address → **Find Parking**.
4. Pins = OSM parking features; badge = **`capacity` tag** if present, else **`?`**.

### Optional Mapbox

In `js/config.js`, set `MAPBOX_PUBLIC_TOKEN: 'pk…'` for a Mapbox basemap and Mapbox geocoding.

---

## 🔌 APIs Used

| API | Role |
|-----|------|
| Overpass | Parking `node`/`way` features |
| Nominatim | Geocoding (no key) |
| Mapbox | Optional map + geocoding |
| Leaflet + Carto | Default basemap |

---

## ✨ What the UI shows

- **Lots / Cap. tagged** — how many features returned; how many have a `capacity` tag in OSM.
- **Sidebar** — fee tag (when mapped), capacity or “not mapped”, distance, optional hours.
- **Detail panel** — OSM fields + link to the object on openstreetmap.org + directions (Google Maps).

---

## 🌐 Adding real occupancy later

1. Build an API (your server) that returns availability keyed by OSM id, e.g. `{ "way/123": { "available": 5 } }`.
2. Set `CONFIG.OCCUPANCY_API_URL` and extend `api.js` / `app.js` to merge that into `lot` objects before rendering.

Until then, the app stays **truthful**: **no fake slots**.

---

## 📄 License

MIT — free to use, modify and deploy.
