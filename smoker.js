// Rough smoking-time estimator. There's no exact formula for this — actual
// time depends on the cut, whether it's wrapped, starting temperature, and
// the smoker itself — so this uses a widely-cited rule of thumb (roughly
// 1.5-2 hrs/lb at 225°F to reach the low-200s) as a baseline-minutes-per-
// pound figure per checkpoint, scaled inversely with smoker temperature.
// The checkpoint rates below aren't evenly spaced with temperature because
// they bake in the "stall" — the well-known plateau around 150-170°F where
// evaporative cooling slows the internal temperature rise dramatically.
(() => {
  const smokerTempInput = document.getElementById("smoker-temp");
  const meatWeightInput = document.getElementById("meat-weight");
  const calcBtn = document.getElementById("calc-btn");
  const rangeWarning = document.getElementById("range-warning");
  const resultBox = document.getElementById("result-box");
  const resultBody = document.getElementById("result-body");

  const REFERENCE_TEMP_F = 225;

  // { temp, ratePerLbMinutes at 225°F, label }
  const CHECKPOINTS = [
    { temp: 145, rate: 25, label: "Safe minimum — whole cuts" },
    { temp: 155, rate: 40, label: "Medium-well" },
    { temp: 160, rate: 50, label: "Well done" },
    { temp: 165, rate: 62, label: "Safe minimum — poultry/ground" },
    { temp: 201, rate: 100, label: "Pulled pork / brisket, probe-tender" },
    { temp: 210, rate: 108, label: "Fully rendered, extra tender" },
  ];

  function formatDuration(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function calculate() {
    const smokerTemp = parseFloat(smokerTempInput.value);
    const weight = parseFloat(meatWeightInput.value);

    rangeWarning.hidden = true;
    resultBox.hidden = true;

    if (!isFinite(smokerTemp) || smokerTemp <= 0 || !isFinite(weight) || weight <= 0) {
      return;
    }

    if (smokerTemp < 180 || smokerTemp > 300) {
      rangeWarning.hidden = false;
      rangeWarning.textContent = "Typical smoking temps run 180–300°F — this estimate is a rougher extrapolation outside that range.";
    }

    const scale = REFERENCE_TEMP_F / smokerTemp;

    resultBody.innerHTML = "";
    CHECKPOINTS.forEach((cp) => {
      const minutes = cp.rate * weight * scale;
      const tr = document.createElement("tr");
      const tempTd = document.createElement("td");
      tempTd.textContent = `${cp.temp}°F`;
      const labelTd = document.createElement("td");
      labelTd.textContent = cp.label;
      const timeTd = document.createElement("td");
      timeTd.textContent = formatDuration(minutes);
      tr.append(tempTd, labelTd, timeTd);
      resultBody.appendChild(tr);
    });

    resultBox.hidden = false;
  }

  calcBtn.addEventListener("click", calculate);
  [smokerTempInput, meatWeightInput].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") calculate();
    });
  });

  calculate(); // show an initial estimate for the default values
})();
