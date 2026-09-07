import "dotenv/config";
import pLimit from 'p-limit'
import { escapeMd, validateTimezone, sanitizeJsonString, getErrorMessage } from '../lib/validators';
import { RainSensor, RiverSensor, Severity, SEVERITY_ORDER, T } from "./types/types.ts";
import { getForecastTideHeight } from "./controllers/getForecastTideHeight.ts";
import { getCurrentTideHeight } from "./controllers/getCurrentTideHeight.ts";
import { calculateRisk } from "./controllers/calculateRisk.ts";
import { getForecastRainMm } from "./controllers/getForecastRainMm.ts";
import { bot } from "../lib/bot.ts";
import { prisma } from "../lib/prisma.ts";
import { buildMessage, buildCityChannelMessage } from "./controllers/buildMessage";
import cron from "node-cron";
import axios from "axios";

const plimit = pLimit(1);

const timezoneValidate = validateTimezone("America/Recife");
const timezone = timezoneValidate ? "America/Recife" : "UTC";

const wasRecentlySentZone = async (zoneId: number, severity: Severity): Promise<boolean> => {
    const minutes = severity === "RED" ? T.COOLDOWN_RED_MIN : T.COOLDOWN_YELLOW_MIN;
    const since = new Date(Date.now() - minutes * 60_000);
    const existing = await prisma.alertLog.findFirst({
        where: { zoneId, severity, triggeredAt: { gte: since } },
    });
    return existing !== null;
};

const wasRecentlySentCity = async (cityId: number): Promise<boolean> => {
    const minutes = T.COOLDOWN_RED_MIN;
    const since = new Date(Date.now() - minutes * 60_000);
    const existing = await prisma.cityAlertLog.findFirst({
        where: { cityId, triggeredAt: { gte: since } }
    });
    return existing !== null;
};

export const executeMonitoringCycle = async () => {
    console.log(`\n[SYSTEM] ${new Date().toLocaleString()} - Iniciando ciclo de varredura de telemetria...`);

    const APAC_RIVER_URL = "https://api.apac.pe.gov.br/api.php/monitoramento_rios";
    const APAC_RAIN_URL = "https://api.apac.pe.gov.br/api.php/precipitacao_acumulada";

    try {
        const cities = await prisma.city.findMany();

        const httpOptions = { 
            timeout: 15000,
            headers: {
                'User-Agent': 'RecifeNimbusMonitor/1.0 (Contact: adonai@nimbus.local)'
            }
        };

        const [rainResult, riverResult] = await Promise.allSettled([
            axios.get(APAC_RAIN_URL, httpOptions),
            axios.get(APAC_RIVER_URL, httpOptions),
        ]);

        const rainSensors: RainSensor[] = rainResult.status === "fulfilled"
            ? rainResult.value.data.features ?? []
            : [];
        const riverSensors: RiverSensor[] = riverResult.status === "fulfilled"
            ? riverResult.value.data.features ?? []
            : [];

        if (rainResult.status === "rejected") {
            console.error(`[APAC] Falha ao carregar chuva: ${getErrorMessage(rainResult.reason)}`);
        }
        if (riverResult.status === "rejected") {
            console.error(`[APAC] Falha ao carregar rios: ${getErrorMessage(riverResult.reason)}`);
        }
        if (rainResult.status === "rejected" || riverResult.status === "rejected") {
            console.error("[APAC] Ciclo cancelado para evitar avaliar risco com dados incompletos.");
            return;
        }

        console.log(`[APAC] Carregados ${rainSensors.length} sensores de chuva e ${riverSensors.length} estações de rios.`);

        let currentTideHeight = getCurrentTideHeight();
        let forecastTideHeight = getForecastTideHeight();

        for (const city of cities) {
            let zoneSummaries: { zoneName: string; severity: Severity; reasons: string[] }[] = [];

            const zones = await prisma.zone.findMany({
                where: { cityId: city.id },
                include: {
                    neighborhoods: {
                        include: { users: true },
                    },
                },
            });

            for (const zone of zones) {
                let localCurrentTide = zone.isCoastal ? currentTideHeight : 0;
                let localForecastTide = zone.isCoastal ? forecastTideHeight : 0;

                const zoneRainSensor: RainSensor[] = rainSensors.filter((sensor) => {
                    return zone.rainSensorNames.some((dbName: string) => {
                        const isOnline = sensor.attributes.hora_3 >= 0;
                        return isOnline && dbName === sensor.attributes.nome;
                    });
                });

                const zoneRiverSensors: RiverSensor[] = riverSensors.filter((sensor) => {
                    return zone.riverBasins.some((dbName: string) => {
                        return dbName === sensor.attributes.namebasin &&
                               sensor.attributes.alerta_tendencia !== "MA" &&
                               sensor.attributes.recent === "s";
                    });
                });

                const maxRainMm = zoneRainSensor.length > 0
                    ? Math.max(...zoneRainSensor.map((s) => s.attributes.hora_1))
                    : 0;

                const prolongedRain3h = zoneRainSensor.length > 0
                    ? Math.max(...zoneRainSensor.map((s) => s.attributes.horas_3 ?? s.attributes.hora_3))
                    : 0;

                const prolongedRain24h = zoneRainSensor.length > 0
                    ? Math.max(...zoneRainSensor.map((s) => s.attributes.horas_24 ?? s.attributes.hora_24))
                    : 0;

                const worstRiverStation = zoneRiverSensors.length > 0
                    ? zoneRiverSensors.reduce((worst, sensor) => {
                        const currentScore = SEVERITY_ORDER[sensor.attributes.situacao as keyof typeof SEVERITY_ORDER] ?? 0;
                        const worstScore = SEVERITY_ORDER[worst.attributes.situacao as keyof typeof SEVERITY_ORDER] ?? 0;
                        return currentScore > worstScore ? sensor : worst;
                    })
                    : null;

                const riverTendencia = worstRiverStation?.attributes.tendencia ?? null;
                const riverSituacao = worstRiverStation?.attributes.situacao ?? null;

                const forecastMm = await plimit(() => getForecastRainMm(zone.latitude, zone.longitude));

                console.log(`   📡 [${zone.name}] Chuva 1h: ${maxRainMm}mm | 3h: ${prolongedRain3h}mm | 24h: ${prolongedRain24h}mm | Rio: ${riverSituacao ?? "Normal"} | Maré: ${localCurrentTide}m`);

                const risk = calculateRisk(
                    maxRainMm,
                    prolongedRain3h,
                    prolongedRain24h,
                    riverSituacao,
                    riverTendencia,
                    localCurrentTide,
                    forecastMm,
                    localForecastTide
                );

                if (risk.severity === "NONE") continue;

                const supressed = await wasRecentlySentZone(zone.id, risk.severity);
                if (supressed) {
                    console.log(`   ⏸ [${zone.name}] Alerta de risco omitido pelo cooldown.`);
                    continue;
                }

                const zoneNameEscaped = escapeMd(zone.name);
                const riskSeverity = risk.severity;
                const riskReasonsEscaped = risk.reasons.map((reason) => escapeMd(reason));

                zoneSummaries.push({ zoneName: zoneNameEscaped, severity: riskSeverity, reasons: riskReasonsEscaped });

                const message = buildMessage(zoneNameEscaped, riskSeverity, riskReasonsEscaped);
                const chatIds = new Set<string>();

                for (const neighborhood of zone.neighborhoods) {
                    for (const user of neighborhood.users) {
                        if (user.isActive) chatIds.add(user.telegramChatId);
                    }
                }

                let sent = 0;
                for (const chatId of chatIds) {
                    try {
                        await bot.telegram.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
                        sent++;
                    } catch (err) {
                        console.error(`[TELEGRAM] Falha ao enviar para o chat ${chatId}: ${getErrorMessage(err)}`);
                    }
                }

                await prisma.alertLog.create({
                    data: {
                        zoneId: zone.id,
                        severity: risk.severity,
                        rain1hMm: risk.maxRainMm,
                        rain3hMm: risk.prolongedRain3h,
                        rain24hMm: risk.prolongedRain24h,
                        tideLevel: risk.tideHeight,
                        forecastRainMm: risk.forecastMm,
                        forecastTide: risk.forecastTide,
                        riverLevel: risk.riverSituacao,
                        riverTendencia: risk.riverTendencia,
                        messageSent: message,
                    },
                });

                console.log(`   🚨 [${zone.name}] Alerta [${risk.severity}] enviado para ${sent} usuários.`);
            }

            const citySupressed = await wasRecentlySentCity(city.id);
            const redZones = zoneSummaries.filter(z => z.severity === 'RED');

            if (redZones.length === 0 || citySupressed) {
                continue;
            }

            const channelId = process.env.TELEGRAM_ALERT_CHANNEL_ID;

            if (!channelId || channelId.trim() === "" || channelId === "undefined") {
                console.error(`⚠️ [CANAL] TELEGRAM_ALERT_CHANNEL_ID inválido ou não carregado.`);
                continue;
            };

            const cityNameEscaped = escapeMd(city.name);
            const channelMessage = buildCityChannelMessage(cityNameEscaped, zoneSummaries);

            try {
                await bot.telegram.sendMessage(channelId.trim(), channelMessage, { parse_mode: "MarkdownV2" });

                await prisma.cityAlertLog.create({
                    data: {
                        cityId: city.id,
                        alertedZones: sanitizeJsonString(zoneSummaries),
                        hasRedAlert: true,
                        severity: 'RED',
                        messageSent: channelMessage,
                    }
                });
                console.log(`📢 [CANAL] Alerta geral consolidado emitido para ${city.name}.`);

            } catch (err) {
                console.error(`[TELEGRAM CHANNEL] Erro no envio geral: ${getErrorMessage(err)}`);
            }
        }
    } catch (err) {
        console.error("[ERROR] Falha crítica no ciclo de monitoramento:", getErrorMessage(err));
    }
};

export const monitorJob = async () => {
    cron.schedule("*/30 * * * *", async () => {
        await executeMonitoringCycle();
    }, { timezone });
};
