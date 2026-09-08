// 10-day forecast for a place the user types in. Uses Open-Meteo, a free
// weather API with no API key and CORS enabled, so this can call it
// straight from the browser: their geocoding endpoint turns the place name
// into coordinates, then the forecast endpoint returns daily highs/lows,
// precipitation chance, and a WMO weather code for each of the next 10 days.
(() => {
  const locationInput = document.getElementById("location-input");
  const searchBtn = document.getElementById("search-btn");
  const statusText = document.getElementById("status-text");
  const resultBox = document.getElementById("result-box");
  const locationName = document.getElementById("location-name");
  const forecastRow = document.getElementById("forecast-row");
  const hourlyPanel = document.getElementById("hourly-panel");
  const hourlyTitle = document.getElementById("hourly-title");
  const hourlyRow = document.getElementById("hourly-row");

  // Standard WMO weather codes used by Open-Meteo — see
  // https://open-meteo.com/en/docs for the full table.
  const WEATHER_CODES = {
    0: ["☀️", "Clear sky"],
    1: ["🌤️", "Mainly clear"],
    2: ["⛅", "Partly cloudy"],
    3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"],
    48: ["🌫️", "Rime fog"],
    51: ["🌦️", "Light drizzle"],
    53: ["🌦️", "Drizzle"],
    55: ["🌧️", "Dense drizzle"],
    56: ["🌧️", "Freezing drizzle"],
    57: ["🌧️", "Freezing drizzle"],
    61: ["🌦️", "Light rain"],
    63: ["🌧️", "Rain"],
    65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"],
    67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Light snow"],
    73: ["🌨️", "Snow"],
    75: ["❄️", "Heavy snow"],
    77: ["❄️", "Snow grains"],
    80: ["🌦️", "Rain showers"],
    81: ["🌧️", "Rain showers"],
    82: ["⛈️", "Violent showers"],
    85: ["🌨️", "Snow showers"],
    86: ["❄️", "Heavy snow showers"],
    95: ["⛈️", "Thunderstorm"],
    96: ["⛈️", "Thunderstorm, hail"],
    99: ["⛈️", "Thunderstorm, hail"],
  };

  function describeWeather(code) {
    return WEATHER_CODES[code] || ["🌡️", "Unknown"];
  }

  function setStatus(message) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
  }

  async function geocode(query) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Location lookup failed — try again.");
    const data = await res.json();
    if (!data.results || !data.results.length) {
      throw new Error(`Couldn't find "${query}" — try a different search.`);
    }
    return data.results[0];
  }

  async function fetchForecast(place) {
    const params = new URLSearchParams({
      latitude: place.latitude,
      longitude: place.longitude,
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      hourly: "temperature_2m,weather_code,precipitation_probability",
      temperature_unit: "fahrenheit",
      timezone: place.timezone || "auto",
      forecast_days: "10",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error("Couldn't load the forecast — try again.");
    return res.json();
  }

  function formatDate(dateStr, index) {
    const date = new Date(`${dateStr}T00:00:00`);
    const weekday = index === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });
    const monthDay = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { weekday, monthDay };
  }

  function formatHour(dateTimeStr) {
    const date = new Date(dateTimeStr); // naive "YYYY-MM-DDTHH:mm" — no timezone conversion, just reads the wall-clock hour
    return date.toLocaleTimeString(undefined, { hour: "numeric" });
  }

  let hourlyData = null; // forecast.hourly from the last fetch, reused for every day clicked
  let selectedDateStr = null;

  function showHourly(dateStr, dayLabel) {
    if (selectedDateStr === dateStr) {
      // Clicking the already-open day closes it.
      selectedDateStr = null;
      hourlyPanel.hidden = true;
      updateSelectedCard();
      return;
    }

    selectedDateStr = dateStr;
    updateSelectedCard();

    const { time, temperature_2m, weather_code, precipitation_probability } = hourlyData;
    hourlyTitle.textContent = `Hour by hour — ${dayLabel}`;
    hourlyRow.innerHTML = "";

    time.forEach((dateTimeStr, i) => {
      if (!dateTimeStr.startsWith(dateStr)) return;
      const [icon] = describeWeather(weather_code[i]);
      const precip = precipitation_probability ? precipitation_probability[i] : null;

      const card = document.createElement("div");
      card.className = "hourly-card";
      card.innerHTML = `
        <div class="hourly-time">${formatHour(dateTimeStr)}</div>
        <div class="hourly-icon">${icon}</div>
        <div class="hourly-temp">${Math.round(temperature_2m[i])}°</div>
        ${precip !== null ? `<div class="hourly-precip">💧 ${precip}%</div>` : ""}
      `;
      hourlyRow.appendChild(card);
    });

    hourlyPanel.hidden = false;
  }

  function updateSelectedCard() {
    forecastRow.querySelectorAll(".forecast-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.date === selectedDateStr);
    });
  }

  function renderForecast(place, forecast) {
    const parts = [place.name, place.admin1, place.country].filter(Boolean);
    locationName.textContent = parts.join(", ");

    hourlyData = forecast.hourly;
    selectedDateStr = null;
    hourlyPanel.hidden = true;

    forecastRow.innerHTML = "";
    const { time, weather_code, temperature_2m_max, temperature_2m_min, precipitation_probability_max } = forecast.daily;

    time.forEach((dateStr, i) => {
      const { weekday, monthDay } = formatDate(dateStr, i);
      const [icon, label] = describeWeather(weather_code[i]);
      const precip = precipitation_probability_max ? precipitation_probability_max[i] : null;

      const card = document.createElement("div");
      card.className = "forecast-card" + (i === 0 ? " is-today" : "");
      card.dataset.date = dateStr;
      card.innerHTML = `
        <div class="forecast-day">${weekday}</div>
        <div class="forecast-date">${monthDay}</div>
        <div class="forecast-icon">${icon}</div>
        <div class="forecast-condition">${label}</div>
        <div class="forecast-temps">${Math.round(temperature_2m_max[i])}° <span class="low">${Math.round(temperature_2m_min[i])}°</span></div>
        ${precip !== null ? `<div class="forecast-precip">💧 ${precip}%</div>` : ""}
      `;
      card.addEventListener("click", () => showHourly(dateStr, `${weekday}, ${monthDay}`));
      forecastRow.appendChild(card);
    });

    resultBox.hidden = false;
  }

  async function search() {
    const query = locationInput.value.trim();
    if (!query) return;

    searchBtn.disabled = true;
    resultBox.hidden = true;
    setStatus("Looking up that location…");

    try {
      const place = await geocode(query);
      setStatus("Loading forecast…");
      const forecast = await fetchForecast(place);
      setStatus(null);
      renderForecast(place, forecast);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong — try again.");
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchBtn.addEventListener("click", search);
  locationInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
})();
