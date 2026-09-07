import fs from 'fs';
import path from 'path';
import axios from 'axios';

const APAC_RIVER_URL = "https://api.apac.pe.gov.br/api.php/monitoramento_rios";
const APAC_RAIN_URL = "https://api.apac.pe.gov.br/api.php/precipitacao_acumulada";

const riverResponse = await axios.get(APAC_RIVER_URL);
const rainResponse = await axios.get(APAC_RAIN_URL);
const forecastResponse = await axios.get("https://api.open-meteo.com/v1/forecast?latitude=-8.05&longitude=-34.9&hourly=precipitation&timezone=America%2FSao_Paulo");

const jsonDataRiver = JSON.stringify(riverResponse.data, null, 2);
const jsonDataRain = JSON.stringify(rainResponse.data, null, 2);
const jsonDataForecast = JSON.stringify(forecastResponse.data, null, 2);

const dir = path.resolve('apiResponses');

// create the directory if it doesn't exist
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
};

const riverFilePath = path.join(dir, 'monitoramento_rios.json');
const rainFilePath = path.join(dir, 'precipitacao_acumulada.json');
const forecastFilePath = path.join(dir, 'forecast.json');

const errorHandler = (err: Error) => {
    if (err) {
        console.error('Error writing JSON response to file:', err);
    } else {
        console.log('JSON responses saved successfully.');
    };
};

try {
    fs.writeFileSync(riverFilePath, jsonDataRiver, 'utf-8');
    fs.writeFileSync(rainFilePath, jsonDataRain, 'utf-8');
    fs.writeFileSync(forecastFilePath, jsonDataForecast, 'utf-8');

} catch (err) {
    errorHandler(err as Error);
};
