# Recife Nimbus

**Recife Nimbus is a TypeScript flood alert system for the Recife Metropolitan Region (RMR).**

Recife and its surrounding is highly vulnerable to flooding due to its unique geography. During the rainy season, the combination of heavy precipitation and high ocean tides frequently overwhelms drainage systems, causing severe urban flooding. **Recife Nimbus** monitors weather, local rain sensors and local river sensor APIs across all RMR cities, cross-references them with zone coordinates, and dispatches warnings to a public Telegram channel and subscribed users before the streets flood.

## Links & Community

| Platform | Link | Description |
|---|---|---|
| ![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=flat&logo=telegram&logoColor=white) | [Recife Nimbus \| Alertas Oficiais](https://t.me/+GzmJKR2chEs1ZTlh) | Public city-wide RED alerts |
| ![Bot](https://img.shields.io/badge/Telegram_Bot-2CA5E0?style=flat&logo=telegram&logoColor=white) | [@Recife\_Nimbus\_BOT](https://web.telegram.org/k/#@Recife_Nimbus_BOT) | Personal zone alerts via DM |
| ![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=flat&logo=instagram&logoColor=white) | [@recifenimbus](https://www.instagram.com/recifenimbus/) | Community updates and news |

---

## Hosting

| Service | Provider | Plan |
|---|---|---|
| Bot & Cron Engine | [Render](https://render.com) | Free tier |
| PostgreSQL Database | [Supabase](https://supabase.com) | Free tier |

## Features

### Automated Monitoring Engine
- **Multi-City Polling:** Evaluates 3-hour rain forecasts intersecting with tide levels across all RMR cities every 15 minutes.
- **Hyper-Local Evaluation:** Iterates through a PostgreSQL hierarchy of City → Zone → Neighborhood.
- **Real-Time Data Integration:** Monitors APAC (Agência Pernambucana de Águas e Clima) rain sensors and river basin stations.
- **Tide Cross-Reference:** Interpolates DHN tide table data for coastal zones; inland zones receive zero tidal weight.
- **Anti-Spam Cooldowns:** Zone alerts: RED = 60 min, YELLOW = 180 min. City channel alerts: 60 min.

### Telegram Alert Broadcasts
- **Public Channel:** Broadcasts consolidated RED alerts to a dedicated public Telegram channel per city.
- **Direct Messages:** Sends zone-level alerts directly to subscribed users via DM.
- **Severity Levels:**
  - **YELLOW** (Predictive): Forecast indicates dangerous rain or tide conditions coming.
  - **RED** (Real-Time Critical): System confirm active flooding conditions.

### Multi-City RMR Coverage
The system supports the full Recife Metropolitan Region:

| City | City |
|---|---|
| Recife | Olinda |
| Jaboatão dos Guararapes | Paulista |
| Camaragibe | Igarassu |
| São Lourenço da Mata | Abreu e Lima |
| Moreno | Araçoiaba |
| Goiana | Ipojuca |
| Itapissuma | Ilha de Itamaracá |
| Cabo de Santo Agostinho | — |

Additional cities can be added via database seeding without code changes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript / Node.js |
| Database | PostgreSQL |
| ORM | Prisma |
| Job Scheduling | node-cron |
| Hosting | Render (bot sistem) + Supabase (DB) |
| Tide Data | DHN tides2026.json (Porto do Recife) |
| Telegram | Telegraf + telegraf-inline-menu |
| Rain Forecast | Open-Meteo API (free, no auth) |
| Real-Time Sensors | APAC ArcGIS API |

---

## Database Schema

The database uses a geographic hierarchy designed for scalable multi-city support.

### Geographic Hierarchy

```
City
├── Zone ── AlertLog (per-zone alert history)
│   │
│   └── Neighborhood
│
└── CityAlertLog (consolidated per-city channel alerts)
```

### Core Models

| Model | Purpose | Key Fields |
|---|---|---|
| **City** | RMR city container | `id`, `name` |
| **Zone** | Sub-region within a city | `name`, `latitude`, `longitude`, `isCoastal`, `rainSensorNames[]`, `riverBasins[]`, `cityId` |
| **Neighborhood** | Street-level alert target | `id`, `name`, `zoneId` |
| **User** | Telegram subscriber | `telegramChatId`, `name`, `neighborhoodId`, `isActive` |
| **AlertLog** | Per-zone alert audit trail | `zoneId`, `rainLevel`, `tideLevel`, `forecastRainMm`, `forecastTide`, `riverLevel`, `riverTendencia`, `severity`, `messageSent`, `triggeredAt` |
| **CityAlertLog** | Consolidated city-level channel alert | `cityId`, `alertedZones`, `hasRedAlert`, `severity`, `messageSent`, `triggeredAt` |

### Data Relationships

- **1 City : N Zones** — Each city is divided into monitoring zones
- **1 Zone : N Neighborhoods** — Each zone covers multiple neighborhoods
- **1 Neighborhood : N Users** — Multiple users can subscribe to the same neighborhood
- **1 Zone : N AlertLogs** — Full alert history per zone with cooldown enforcement
- **1 City : N CityAlertLogs** — Consolidated channel alerts per city

### Notable Zone Fields

- `isCoastal` — when `true`, the zone receives interpolated tide data from `tides2026.json`; inland zones receive `tideHeight: 0` to prevent false compound flood alerts
- `rainSensorNames[]` — matched against APAC pluviometer `nome` field to filter sensors per zone
- `riverBasins[]` — matched against APAC fluviometer `namebasin` field to filter river stations per zone

---

## Alert System

### How Alerts Flow

```
1. Application startup validates environment variables and launches the Telegram bot
   |
2. Health endpoint starts on port 10000
   |
3. `monitorJob()` schedules the flood monitoring cycle every 30 minutes
   |
4. The monitoring cycle fetches:
   - APAC pluviometer data for real-time rain
   - APAC fluviometer data for river status and trends
   - Tide table data from `src/config/tides2026.json` for current and 3-hour tide estimates
   |
5. For each city and each zone:
   - Filter APAC rain sensors using `zone.rainSensorNames`
   - Filter APAC river stations using `zone.riverBasins`
   - Fetch Open-Meteo 3-hour rainfall forecast for the zone coordinates
   - If `zone.isCoastal` is false, set tide height to `0` for the zone
   |
6. The risk engine (`calculateRisk`) evaluates the zone and returns a severity plus reasons
   |
7. If severity is `RED` or `YELLOW` and the zone cooldown has expired:
   - Send direct Telegram messages to active users in the zone
   - Save a zone alert record to `AlertLog`
   |
8. If one or more zones in a city are `RED` and the city cooldown has expired:
   - Send a consolidated RED message to the configured Telegram channel
   - Save a city alert record to `CityAlertLog`
```

### Risk calculator behavior

`calculateRisk` receives these zone inputs:
- `maxRainMm` — highest real-time rain from matching APAC rain sensors (`hora_1`)
- `prolongedRain3h` — highest 3-hour historical rain from APAC sensors
- `prolongedRain24h` — highest 24-hour accumulated rain from APAC sensors
- `riverSituacao` — APAC river status text
- `riverTendencia` — APAC river trend code (`S`, `M`, `D`)
- `tideHeight` — current tide in meters (or `0` for inland zones)
- `forecastMm` — total forecast rain over the next 3 hours from Open-Meteo
- `forecastTide` — estimated tide height in 3 hours from DHN data

The function returns `RED` if any of these conditions are true:
- Real-time rain >= 30 mm/h
- River status is `Alerta` or `Inundação`
- Compound current risk: real-time rain >= 15 mm/h AND current tide >= 2.0 m
- Compound forecast risk: forecast rain >= 15 mm AND forecast tide >= 2.0 m
- Prolonged 24h rain >= 100 mm

The function returns `YELLOW` when none of the RED conditions are met and at least one of these is true:
- Real-time rain >= 15 mm/h
- Total rain in the past 3 hours >= 25 mm
- Moderate 24h accumulation >= 50 mm
- River status is `Pré-alerta` or `Atenção`
- Forecast rain >= 10 mm in the next 3 hours
- Current or forecast tide >= 2.7 m

### RED alert triggers

Red severity is triggered immediately when any of the following conditions exist:
- `maxRainMm >= 30` (intense real-time rain)
- `riverSituacao === 'Alerta'` or `'Inundação'`
- `maxRainMm >= 15` and `tideHeight >= 2.0` at the same time
- `forecastMm >= 15` and `forecastTide >= 2.0` for the next 3 hours
- `prolongedRain24h >= 100`

### YELLOW alert triggers

Yellow severity is returned when RED is not triggered and at least one of the following is true:
- `maxRainMm >= 15`
- `prolongedRain3h >= 25`
- `prolongedRain24h >= 50`
- `riverSituacao === 'Pré-alerta'` or `'Atenção'`
- `forecastMm >= 10`
- `forecastTide >= 2.7`
- `tideHeight >= 2.7`

---

## Architecture

### Project Structure

```
src/
├── index.ts                          Entry point
├── lib/
│   ├── prisma.ts                     Prisma client singleton
│   ├── bot.ts                        Telegraf bot instance
│   ├── rateLimiter.ts                Bot rate limiter
│   └── validators.ts                 Input sanitization and security helpers
├── bot/
│   └── telegramBot.ts                Bot command handlers and inline menus
├── config/
│   ├── env.ts                        Environment variable helpers
│   ├── tides2026.json                DHN tide table (Porto do Recife)
│   └── neighborhoods-official.json  Neighborhoods reference data
└── cron/
    ├── floodMonitoring.ts            Main cron job (runs every 30 minutes)
    ├── types/
    │   └── types.ts                  Interfaces, thresholds and constants
    └── controllers/
        ├── calculateRisk.ts          Risk decision engine (pure function)
        ├── buildMessage.ts           Telegram message formatter
        ├── getCurrentTideHeight.ts   Interpolates current tide height
        ├── getForecastTideHeight.ts  Interpolates tide height in 3 hours
        └── getForecastRainMm.ts      Open-Meteo 3-hour rain forecast
```

### Controller Chain

| Order | Controller | Responsibility |
|---|---|---|
| 1 | `getForecastRainMm` | Calls Open-Meteo for predicted rainfall per zone |
| 2 | `getCurrentTideHeight` | Interpolates current tide from DHN JSON |
| 3 | `getForecastTideHeight` | Interpolates tide height 3 hours from now |
| 4 | `calculateRisk` | Combines all inputs, returns severity and reasons |
| 5 | `buildMessage` | Formats the Telegram alert string |

---

## Observability

### AlertLog Table

Every alert is logged with zone ID, timestamp, real-time conditions at the moment of dispatch (rain, tide, river status, forecast values), the exact message text sent, and severity level. This provides a full audit trail for post-event analysis.

```sql
-- View recent alerts
SELECT * FROM "AlertLog" ORDER BY "triggeredAt" DESC LIMIT 10;

-- View active subscribers
SELECT COUNT(*) AS active_users FROM "User" WHERE "isActive" = true;
```

### CityAlertLog Table

Tracks consolidated city-level RED alerts sent to the public channel, including which zones triggered and whether any zone reached RED severity.

---

## Notes

- The active cron schedule is every 30 minutes (`src/cron/floodMonitoring.ts`).
- Tide interpolation is based on `src/config/tides2026.json`.
- Inland zones bypass tide-based compound risk by using `tideHeight = 0`.
- The repository currently has no dedicated automated test suite configured.

---

## Contributing

Contributions are welcome. Potential areas for enhancement:

- [ ] Historical flood pattern analysis
- [ ] WhatsApp integration
- [ ] SMS fallback for critical alerts

### Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push the branch: `git push origin feature/your-feature`
5. Open a pull request with a clear description of the change

---

## Acknowledgments

- **APAC (Agência Pernambucana de Águas e Clima)** — Real-time hydrological sensor data
- **DHN (Diretoria de Hidrografia e Navegação)** — Official tide table for Porto do Recife
- **Open-Meteo** — Free, open-source weather forecast API
- **Telegram Bot API** — Alert delivery infrastructure

---

## License

ISC License. See [LICENSE](LICENSE) for details.

---

**Maintainer:** Adonai Artur  
