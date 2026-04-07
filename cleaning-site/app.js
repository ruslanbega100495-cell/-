const N8N_WEBHOOK_URL = ""; // Вставьте сюда ваш webhook n8n, если хотите принимать заявки прямо в n8n.

function rub(n) {
  const x = Math.round(n);
  return new Intl.NumberFormat("ru-RU").format(x) + " ₽";
}

function hoursToHuman(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function getSelectedExtras(form) {
  return Array.from(form.querySelectorAll('input[name="extras"]:checked')).map((x) => x.value);
}

function computeEstimate(input) {
  const area = Math.max(10, Number(input.area || 0));
  const bathrooms = Math.max(0, Number(input.bathrooms || 0));
  const windows = Math.max(0, Number(input.windows || 0));
  const service = input.service || "maintenance";
  const building = input.building || "new";
  const extras = input.extras || [];

  const basePerM2 = {
    maintenance: 90,
    general: 135,
    post_reno: 170,
  }[service];

  const baseTimeRateM2PerHour = {
    maintenance: 22,
    general: 15,
    post_reno: 11,
  }[service];

  const buildingK = building === "old" ? 1.18 : 1.0;

  const bathAdd = bathrooms * (service === "maintenance" ? 650 : service === "general" ? 850 : 1000);
  const windowsAdd = windows * (service === "post_reno" ? 420 : 360);

  const extrasPrice = {
    fridge: 900,
    oven: 700,
    hood: 400,
    cabinet_in: 900,
    balcony: 800,
    pets: 650,
  };
  const extrasTimeH = {
    fridge: 0.7,
    oven: 0.55,
    hood: 0.35,
    cabinet_in: 0.75,
    balcony: 0.8,
    pets: 0.5,
  };

  const extrasSum = extras.reduce((acc, k) => acc + (extrasPrice[k] || 0), 0);
  const extrasTime = extras.reduce((acc, k) => acc + (extrasTimeH[k] || 0), 0);

  const base = area * basePerM2;
  const price = (base + bathAdd + windowsAdd + extrasSum) * buildingK;

  const baseHours = area / baseTimeRateM2PerHour;
  const hoursRaw = (baseHours + extrasTime) * (building === "old" ? 1.12 : 1.0);

  const targetShiftHours = 4.0;
  const team = Math.max(1, Math.min(6, Math.ceil(hoursRaw / targetShiftHours)));
  const hoursWithTeam = hoursRaw / team;

  const teamText =
    team === 1 ? "1 клинер" : team === 2 ? "2 клинера" : team === 3 ? "3 клинера" : `${team} клинеров`;

  return {
    price,
    hours: hoursWithTeam,
    team,
    teamText,
  };
}

function readCalcForm(form) {
  const data = new FormData(form);
  return {
    service: String(data.get("service") || "maintenance"),
    area: Number(data.get("area") || 0),
    building: String(data.get("building") || "new"),
    bathrooms: Number(data.get("bathrooms") || 0),
    windows: Number(data.get("windows") || 0),
    address: String(data.get("address") || ""),
    extras: getSelectedExtras(form),
  };
}

function setStatus(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.style.color =
    kind === "success"
      ? "rgba(22, 163, 74, 0.95)"
      : kind === "error"
        ? "rgba(220, 38, 38, 0.95)"
        : "rgba(20, 10, 18, 0.72)";
}

async function postLead(payload) {
  if (!N8N_WEBHOOK_URL) {
    return { ok: true, mode: "local" };
  }

  const res = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status };
}

function main() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const calcForm = document.getElementById("calcForm");
  const priceOut = document.getElementById("priceOut");
  const timeOut = document.getElementById("timeOut");
  const teamOut = document.getElementById("teamOut");
  const calcReset = document.getElementById("calcReset");

  let lastEstimate = null;
  let lastInput = null;

  function renderEstimate() {
    if (!calcForm) return;
    const input = readCalcForm(calcForm);
    const est = computeEstimate(input);
    lastEstimate = est;
    lastInput = input;

    if (priceOut) priceOut.textContent = rub(est.price);
    if (timeOut) timeOut.textContent = hoursToHuman(est.hours);
    if (teamOut) teamOut.textContent = est.teamText;
  }

  if (calcForm) {
    calcForm.addEventListener("submit", (e) => {
      e.preventDefault();
      renderEstimate();
    });

    calcForm.addEventListener("input", () => {
      renderEstimate();
    });

    renderEstimate();
  }

  if (calcReset && calcForm) {
    calcReset.addEventListener("click", () => {
      calcForm.reset();
      const area = calcForm.querySelector('input[name="area"]');
      if (area) area.value = "50";
      const bathrooms = calcForm.querySelector('input[name="bathrooms"]');
      if (bathrooms) bathrooms.value = "1";
      const windows = calcForm.querySelector('input[name="windows"]');
      if (windows) windows.value = "0";
      renderEstimate();
    });
  }

  const leadForm = document.getElementById("leadForm");
  const leadStatus = document.getElementById("leadStatus");
  if (leadForm) {
    leadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(leadForm);
      const payload = {
        kind: "lead",
        source: "mini_form",
        name: String(fd.get("name") || ""),
        phone: String(fd.get("phone") || ""),
        address: String(fd.get("address") || ""),
        city: "Санкт-Петербург",
        created_at: new Date().toISOString(),
      };

      setStatus(leadStatus, "Отправляем…", "info");
      try {
        const r = await postLead(payload);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setStatus(
          leadStatus,
          N8N_WEBHOOK_URL ? "Заявка принята. Мы свяжемся с вами в ближайшее время." : "Заявка сохранена локально (включите webhook n8n).",
          "success",
        );
        leadForm.reset();

        try {
          const items = JSON.parse(localStorage.getItem("cleanspb_leads") || "[]");
          items.push(payload);
          localStorage.setItem("cleanspb_leads", JSON.stringify(items));
        } catch {
          // ignore
        }
      } catch (err) {
        setStatus(leadStatus, "Не удалось отправить. Проверьте интернет и webhook.", "error");
      }
    });
  }

  const orderForm = document.getElementById("orderForm");
  const orderStatus = document.getElementById("orderStatus");
  if (orderForm) {
    orderForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!lastEstimate || !lastInput) {
        renderEstimate();
      }

      const fd = new FormData(orderForm);
      const payload = {
        kind: "lead",
        source: "calculator",
        city: "Санкт-Петербург",
        phone: String(fd.get("phone") || ""),
        comment: String(fd.get("comment") || ""),
        estimate: {
          price_rub: Math.round(lastEstimate?.price || 0),
          duration_hours: Number((lastEstimate?.hours || 0).toFixed(2)),
          team: lastEstimate?.team || 1,
          team_text: lastEstimate?.teamText || "1 клинер",
        },
        input: lastInput,
        created_at: new Date().toISOString(),
      };

      setStatus(orderStatus, "Отправляем…", "info");
      try {
        const r = await postLead(payload);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setStatus(
          orderStatus,
          N8N_WEBHOOK_URL ? "Заявка по расчету принята. Мы подтвердим слот и состав работ." : "Заявка сохранена локально (включите webhook n8n).",
          "success",
        );
        orderForm.reset();

        try {
          const items = JSON.parse(localStorage.getItem("cleanspb_leads") || "[]");
          items.push(payload);
          localStorage.setItem("cleanspb_leads", JSON.stringify(items));
        } catch {
          // ignore
        }
      } catch (err) {
        setStatus(orderStatus, "Не удалось отправить. Проверьте интернет и webhook.", "error");
      }
    });
  }

  // Included tabs (room/kitchen/bath)
  const includedImg = document.getElementById("includedImg");
  const includedList = document.getElementById("includedList");
  const itabs = Array.from(document.querySelectorAll("[data-itab]"));

  const includedData = {
    room: {
      img: "./assets/tab-room.svg",
      alt: "Комната",
      items: [
        "обеспылим стены и потолки",
        "обеспылим осветительные приборы (кроме хрустальных)",
        "вымоем окна (доп.)",
        "обработаем парогенератором батареи сверху (по опции)",
        "обеспылим предметы интерьера",
        "пропылесосим ковер",
        "вымоем пол",
      ],
    },
    kitchen: {
      img: "./assets/tab-kitchen.svg",
      alt: "Кухня",
      items: [
        "протрем фасады и столешницу, уберем жир с ключевых зон",
        "очистим фартук и плиту (снаружи)",
        "помоем раковину и смеситель, продезинфицируем поверхности",
        "вынесем мусор, наведем порядок в зоне готовки",
        "духовка/холодильник/шкафы внутри — по доп.опциям",
      ],
    },
    bath: {
      img: "./assets/tab-bath.svg",
      alt: "Ванная",
      items: [
        "отмоем плитку и швы в видимых зонах",
        "очистим и отполируем сантехнику, смесители",
        "обработаем поверхности и зону душа/ванны",
        "вымоем зеркала и стеклянные поверхности",
        "вымоем пол и протрем плинтусы",
      ],
    },
  };

  function renderIncluded(key) {
    const d = includedData[key];
    if (!d || !includedImg || !includedList) return;

    includedImg.src = d.img;
    includedImg.alt = d.alt;

    const ul = document.createElement("ul");
    ul.className = "dots";
    d.items.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });

    const btn = document.createElement("a");
    btn.className = "btn btn--primary";
    btn.href = "#calculator";
    btn.textContent = "Рассчитать стоимость";

    includedList.innerHTML = "";
    includedList.appendChild(ul);
    includedList.appendChild(btn);
  }

  if (itabs.length > 0 && includedImg && includedList) {
    itabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-itab");
        itabs.forEach((x) => {
          const active = x === btn;
          x.classList.toggle("is-active", active);
          x.setAttribute("aria-selected", active ? "true" : "false");
        });
        renderIncluded(key);
      });
    });
    renderIncluded("room");
  }
}

document.addEventListener("DOMContentLoaded", main);

