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
  const crutchCheck = document.getElementById("crutch-check");
  const calcBtn = document.getElementById("calc-btn");
  const rangeWarning = document.getElementById("range-warning");
  const resultBox = document.getElementById("result-box");
  const resultBody = document.getElementById("result-body");

  const REFERENCE_TEMP_F = 225;

  // { temp, ratePerLbMinutes at 225°F, rateWrapped, label }
  // rateWrapped models the Texas crutch: wrapping in foil/butcher paper
  // (typically once the stall sets in, around 150°F) traps steam and
  // roughly braises the meat the rest of the way, cutting a big chunk off
  // the time still needed past that point — so 145°F is unaffected (the
  // wrap hasn't happened yet), and later checkpoints get meaningfully
  // faster. That speedup is a rough approximation, not a measured figure.
  const CHECKPOINTS = [
    { temp: 145, rate: 25, rateWrapped: 25, label: "Safe minimum — whole cuts" },
    { temp: 155, rate: 40, rateWrapped: 33, label: "Medium-well" },
    { temp: 160, rate: 50, rateWrapped: 39, label: "Well done" },
    { temp: 165, rate: 62, rateWrapped: 46, label: "Safe minimum — poultry/ground" },
    { temp: 201, rate: 100, rateWrapped: 67, label: "Pulled pork / brisket, probe-tender" },
    { temp: 210, rate: 108, rateWrapped: 71, label: "Fully rendered, extra tender" },
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
    const wrapped = crutchCheck.checked;

    resultBody.innerHTML = "";
    CHECKPOINTS.forEach((cp) => {
      const minutes = (wrapped ? cp.rateWrapped : cp.rate) * weight * scale;
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
  crutchCheck.addEventListener("change", calculate);
  [smokerTempInput, meatWeightInput].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") calculate();
    });
  });

  calculate(); // show an initial estimate for the default values
})();
