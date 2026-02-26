<<<<<<< HEAD

    // ---------- Global state ----------
    let currentSchedule = null;
    let allPlayers = [];
    let scheduleDirty = false;

    // ---------- DOM refs ----------
    const form = document.getElementById("playerForm");
    const scheduleList = document.getElementById("scheduleList");

    const btnGenerate = document.getElementById("btnGenerate");
    const btnFilter = document.getElementById("btnFilter");
    const btnClearFilter = document.getElementById("btnClearFilter");
    const btnPrint = document.getElementById("btnPrint");
    const btnSaveSchedule = document.getElementById("btnSaveSchedule");

    // Modal refs
    const modalBackdrop = document.getElementById("modalBackdrop");
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const modalForm = document.getElementById("modalForm");
    const modalClose = document.getElementById("modalClose");
    const modalCancel = document.getElementById("modalCancel");

    let modalOnSubmit = null;

    // ---------- API helper ----------
    async function api(url, options) {
      const res = await fetch(url, options);
      if (!res.ok) {
        let details = "";
        try { details = await res.text(); } catch (_) {}
        throw new Error(`${options?.method || "GET"} ${url} failed: ${res.status} ${details}`);
      }
      return res.json();
    }

    // ---------- Helpers ----------
    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function formatScore(v) {
      const n = Number(v ?? 0);
      return Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, "").replace(/\.$/, "");
    }

    function setScheduleDirty(isDirty) {
      scheduleDirty = isDirty;

      const status = document.getElementById("scheduleStatus");
      if (btnSaveSchedule) btnSaveSchedule.disabled = !isDirty;

      if (status) {
        status.textContent = isDirty ? "Unsaved changes" : "Saved";
        status.style.color = isDirty ? "#22c55e" : "rgba(233,238,252,0.75)";
      }
    }

    function getPlayerMapByLevel(level) {
      const list = allPlayers.filter(p => Number(p.level) === Number(level));
      const byId = new Map(list.map(p => [Number(p.id), p]));
      return { list, byId };
    }

    function playerNameFromId(level, id) {
      if (id === null || id === undefined) return "BYE";
      const { byId } = getPlayerMapByLevel(level);
      return byId.get(Number(id))?.name || "Unknown";
    }

    function buildPlayerIdOptions(level, selectedId) {
      const { list } = getPlayerMapByLevel(level);
      const sel = selectedId === null || selectedId === undefined ? "" : String(selectedId);

      const opts = list
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(p => `<option value="${escapeHtml(p.id)}" ${String(p.id) === sel ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("");

      return `<option value="" ${sel === "" ? "selected" : ""}>BYE</option>` + opts;
    }

    // ---------- Modal helpers ----------
    function openModal({ title, bodyHtml, onSubmit }) {
      modalTitle.textContent = title;
      modalBody.innerHTML = bodyHtml;
      modalOnSubmit = onSubmit;

      modalBackdrop.classList.remove("hidden");
      modalBackdrop.setAttribute("aria-hidden", "false");

      const first = modalBody.querySelector("input, select, textarea, button");
      if (first) first.focus();
    }

    function closeModal() {
      modalBackdrop.classList.add("hidden");
      modalBackdrop.setAttribute("aria-hidden", "true");
      modalBody.innerHTML = "";
      modalOnSubmit = null;
    }

    modalClose?.addEventListener("click", closeModal);
    modalCancel?.addEventListener("click", closeModal);

    modalBackdrop?.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalBackdrop && !modalBackdrop.classList.contains("hidden")) {
        closeModal();
      }
    });

    modalForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (typeof modalOnSubmit === "function") {
        await modalOnSubmit(new FormData(modalForm));
      }
    });

    // ---------- Players ----------
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("name").value.trim();
      const level = document.getElementById("level").value;

      try {
        const players = await api("/add-player", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, level })
        });

        allPlayers = Array.isArray(players) ? players : [];
        renderPlayers(allPlayers);
        form.reset();
      } catch (err) {
        console.error(err);
        alert("Add player failed. Check console/logs.");
      }
    });

    async function loadPlayers() {
      try {
        const players = await api("/players");
        allPlayers = Array.isArray(players) ? players : [];
        renderPlayers(allPlayers);
      } catch (err) {
        console.error(err);
        allPlayers = [];
        renderPlayers([]);
      }
    }

    function renderPlayers(players) {
      const tbody = document.querySelector("#playerTable tbody");
      if (!tbody) return;

      tbody.innerHTML = "";

      const sorted = [...(players || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      sorted.forEach((p, index) => {
        const tr = document.createElement("tr");

        const tdRank = document.createElement("td");
        tdRank.textContent = index + 1;

        const tdName = document.createElement("td");
        tdName.textContent = p.name;

        const tdLevel = document.createElement("td");
        tdLevel.textContent = p.level;

        const tdScore = document.createElement("td");
        tdScore.textContent = formatScore(p.score);

        const tdActions = document.createElement("td");
        tdActions.className = "no-print";

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.className = "admin-btn";
        editBtn.addEventListener("click", () => editPlayer(p.id, p.name, p.level, p.score ?? 0));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "admin-btn btn-danger";
        deleteBtn.addEventListener("click", () => deletePlayer(p.id, deleteBtn));

        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);

        tr.appendChild(tdRank);
        tr.appendChild(tdName);
        tr.appendChild(tdLevel);
        tr.appendChild(tdScore);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    }

    async function deletePlayer(id, btn) {
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Deleting…";
        }
        await api(`/players/${id}`, { method: "DELETE" });
        await loadPlayers();

        if (currentSchedule) renderSchedule(currentSchedule);
      } catch (err) {
        console.error(err);
        alert("Delete failed. Player may be involved in a scheduled match. Check console.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Delete";
        }
      }
    }

    function editPlayer(id, currentName, currentLevel, currentScore) {
      openModal({
        title: "Edit Player",
        bodyHtml: `
          <div class="field">
            <label for="mp_name">Name</label>
            <input id="mp_name" name="name" type="text" value="${escapeHtml(currentName)}" required />
          </div>

          <div class="field">
            <label for="mp_level">Level</label>
            <select id="mp_level" name="level">
              <option value="1" ${String(currentLevel) === "1" ? "selected" : ""}>Level 1</option>
              <option value="2" ${String(currentLevel) === "2" ? "selected" : ""}>Level 2</option>
              <option value="3" ${String(currentLevel) === "3" ? "selected" : ""}>Level 3</option>
            </select>
          </div>

          <div class="field">
            <label for="mp_score">Score</label>
            <input id="mp_score" name="score" type="number" step="0.5" value="${escapeHtml(currentScore ?? 0)}" />
          </div>
        `,
        onSubmit: async (fd) => {
          const name = fd.get("name").toString().trim();
          const level = fd.get("level").toString();
          const score = fd.get("score").toString();

          try {
            await api(`/players/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, level, score })
            });

            closeModal();
            await loadPlayers();
            if (currentSchedule) renderSchedule(currentSchedule);
          } catch (err) {
            console.error(err);
            alert("Save player failed. Check console.");
          }
        }
      });
    }

    // ---------- Schedules ----------
    btnGenerate?.addEventListener("click", generateSchedule);
    btnFilter?.addEventListener("click", applyDateFilter);
    btnClearFilter?.addEventListener("click", clearDateFilter);
    btnPrint?.addEventListener("click", () => window.print());
    btnSaveSchedule?.addEventListener("click", saveSchedule);

    // ✅ FIX #1: define addScheduleToList at top-level (it was incorrectly nested inside loadSchedules)
    function addScheduleToList(s, { prepend = false } = {}) {
      const li = document.createElement("li");
      li.textContent = `Schedule ${s.createdAt} `;

      const viewBtn = document.createElement("button");
      viewBtn.textContent = "View";
      viewBtn.className = "admin-btn";
      viewBtn.addEventListener("click", () => viewSchedule(s.id));

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.className = "admin-btn btn-danger";
      deleteBtn.addEventListener("click", () => deleteSchedule(s.id, deleteBtn));

      li.appendChild(viewBtn);
      li.appendChild(deleteBtn);

      if (prepend && scheduleList.firstChild) scheduleList.insertBefore(li, scheduleList.firstChild);
      else scheduleList.appendChild(li);
    }

    async function generateSchedule() {
      try {
        // optional but helpful so the edit dropdowns have latest roster
        await loadPlayers();

        const newSchedule = await api("/schedule", { method: "POST" });

        // Show the schedule immediately
        renderSchedule(newSchedule);

        // ✅ FIX #2: this now works because addScheduleToList is in scope
        addScheduleToList({ id: newSchedule.id, createdAt: newSchedule.createdAt }, { prepend: true });

        document.getElementById("printArea")?.scrollIntoView({ behavior: "smooth" });

        // Optional: refresh list from server (safe even if it fails)
        loadSchedules({ keepCurrent: true }).catch(() => {});
      } catch (err) {
        console.error(err);
        alert("Generate schedule failed. Check console/logs.");
      }
    }

    async function loadSchedules({ keepCurrent = false } = {}) {
      try {
        const schedules = await api("/schedules");
        const list = Array.isArray(schedules) ? schedules : [];

        scheduleList.innerHTML = "";

        list.forEach((s) => addScheduleToList(s, { prepend: false }));

        // Only auto-load a schedule if we aren't editing unsaved changes
        if (!keepCurrent && !scheduleDirty) {
          if (list.length > 0) await viewSchedule(list[list.length - 1].id);
          else clearScheduleDisplay();
        }

        if (list.length === 0) clearScheduleDisplay();
      } catch (err) {
        console.error(err);
        clearScheduleDisplay();
      }
    }

    async function viewSchedule(id) {
      if (scheduleDirty && !confirm("You have unsaved changes. Switch schedules anyway?")) return;

      try {
        if (!allPlayers.length) await loadPlayers();

        const schedule = await api(`/schedules/${id}`);
        renderSchedule(schedule);
        document.getElementById("printArea")?.scrollIntoView({ behavior: "smooth" });
      } catch (err) {
        console.error(err);
        alert("View schedule failed. Check console/logs.");
      }
    }

    async function deleteSchedule(id, btn) {
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Deleting…";
        }
        await api(`/schedules/${id}`, { method: "DELETE" });

        if (currentSchedule?.id === Number(id) || String(currentSchedule?.id) === String(id)) {
          currentSchedule = null;
          setScheduleDirty(false);
        }

        await loadSchedules({ keepCurrent: true });
      } catch (err) {
        console.error(err);
        alert("Delete schedule failed. Check console/logs.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Delete";
        }
      }
    }

    function normalizeMatchesForUI(matches) {
      return (matches || []).map(m => ({
        ...m,
        player1Id: m.player1Id === null || m.player1Id === undefined ? null : Number(m.player1Id),
        player2Id: m.player2Id === null || m.player2Id === undefined ? null : Number(m.player2Id),
        player1: m.player1 ?? playerNameFromId(m.level, m.player1Id),
        player2: m.player2 ?? playerNameFromId(m.level, m.player2Id),
      }));
    }

    function renderSchedule(schedule) {
      currentSchedule = {
        ...schedule,
        matches: normalizeMatchesForUI(schedule?.matches || [])
      };

      document.getElementById("printTitle").textContent = "Round Robin Schedule";
      document.getElementById("printMeta").textContent =
        `Created: ${currentSchedule.createdAt} | Matches: ${currentSchedule.matches.length}`;

      renderMatches(currentSchedule.matches);
      setScheduleDirty(false);
    }

    // ---------- Render Matches ----------
    function renderMatches(matches) {
      const tbody = document.querySelector("#printTable tbody");
      if (!tbody) return;

      tbody.innerHTML = "";
      if (!matches || matches.length === 0) return;

      const sorted = [...matches].sort((a, b) => {
        if (Number(a.level) !== Number(b.level)) return Number(a.level) - Number(b.level);
        const dc = String(a.date).localeCompare(String(b.date));
        if (dc !== 0) return dc;
        return String(a.matchId).localeCompare(String(b.matchId));
      });

      let currentLevel = null;

      sorted.forEach(m => {
        if (m.level !== currentLevel) {
          currentLevel = m.level;

          const levelRow = document.createElement("tr");
          levelRow.className = "level-divider";

          const td = document.createElement("td");
          td.colSpan = 5;
          td.textContent = `Level ${currentLevel}`;
          td.className = "level-header";

          levelRow.appendChild(td);
          tbody.appendChild(levelRow);
        }

        const tr = document.createElement("tr");

        const tdDate = document.createElement("td");
        tdDate.textContent = m.date;

        const tdLevel = document.createElement("td");
        tdLevel.textContent = `Level ${m.level}`;

        const tdPlayer = document.createElement("td");
        tdPlayer.textContent = m.player1 ?? playerNameFromId(m.level, m.player1Id);

        const tdOpponent = document.createElement("td");
        tdOpponent.textContent = m.player2 ?? playerNameFromId(m.level, m.player2Id);

        const tdActions = document.createElement("td");
        tdActions.className = "no-print";

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.className = "admin-btn";
        editBtn.addEventListener("click", () => editMatch(m));

        tdActions.appendChild(editBtn);

        tr.appendChild(tdDate);
        tr.appendChild(tdLevel);
        tr.appendChild(tdPlayer);
        tr.appendChild(tdOpponent);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    }

    // ---------- Filter by date ----------
    function applyDateFilter() {
      if (!currentSchedule) return;

      const selected = document.getElementById("filterDate").value;
      if (!selected) return;

      const filtered = (currentSchedule.matches || []).filter(m => m.date === selected);

      document.getElementById("printMeta").textContent =
        `Matches on ${selected} | Count: ${filtered.length}`;

      renderMatches(filtered);
    }

    function clearDateFilter() {
      if (!currentSchedule) return;

      document.getElementById("filterDate").value = "";
      document.getElementById("printMeta").textContent =
        `Created: ${currentSchedule.createdAt} | Matches: ${currentSchedule.matches.length}`;

      renderMatches(currentSchedule.matches);
    }

    // ---------- Edit match (draft-only; edits IDs so PUT works) ----------
    function editMatch(m) {
      if (!currentSchedule) return;
      if (!m.matchId) {
        alert("This schedule/match is missing matchId. Generate a new schedule.");
        return;
      }

      openModal({
        title: "Edit Match",
        bodyHtml: `
          <div class="field">
            <label for="mm_date">Date</label>
            <input id="mm_date" name="date" type="date" value="${escapeHtml(m.date)}" required />
          </div>

          <div class="field">
            <label for="mm_player1Id">Player</label>
            <select id="mm_player1Id" name="player1Id">
              ${buildPlayerIdOptions(m.level, m.player1Id)}
            </select>
          </div>

          <div class="field">
            <label for="mm_player2Id">Opponent</label>
            <select id="mm_player2Id" name="player2Id">
              ${buildPlayerIdOptions(m.level, m.player2Id)}
            </select>
          </div>

          <div class="field">
            <label for="mm_status">Status</label>
            <select id="mm_status" name="status">
              ${["scheduled", "completed", "forfeit", "canceled"].map(s =>
                `<option value="${s}" ${m.status === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </div>

          <div class="field">
            <label for="mm_result">Result (optional)</label>
            <input id="mm_result" name="result" type="text"
              placeholder="e.g. 1-0, 0-1, 0.5-0.5"
              value="${escapeHtml(m.result ?? "")}" />
          </div>

          <div class="field">
            <label for="mm_notes">Notes (optional)</label>
            <textarea id="mm_notes" name="notes">${escapeHtml(m.notes ?? "")}</textarea>
          </div>
        `,
        onSubmit: async (fd) => {
          const date = fd.get("date").toString();
          const player1IdRaw = fd.get("player1Id").toString();
          const player2IdRaw = fd.get("player2Id").toString();
          const status = fd.get("status").toString();
          const result = fd.get("result").toString().trim() || null;
          const notes = fd.get("notes").toString().trim() || "";

          const player1Id = player1IdRaw ? Number(player1IdRaw) : null;
          const player2Id = player2IdRaw ? Number(player2IdRaw) : null;

          if (player1Id && player2Id && player1Id === player2Id) {
            alert("Player and Opponent cannot be the same.");
            return;
          }

          const idx = (currentSchedule.matches || []).findIndex(x => x.matchId === m.matchId);
          if (idx === -1) {
            alert("Match not found in current schedule.");
            return;
          }

          const updatedMatch = {
            ...currentSchedule.matches[idx],
            date,
            player1Id,
            player2Id,
            player1: playerNameFromId(m.level, player1Id),
            player2: playerNameFromId(m.level, player2Id),
            status,
            result,
            notes
          };

          currentSchedule.matches[idx] = updatedMatch;

          closeModal();
          document.getElementById("printMeta").textContent =
            `Created: ${currentSchedule.createdAt} | Matches: ${currentSchedule.matches.length}`;
          renderMatches(currentSchedule.matches);
          setScheduleDirty(true);
        }
      });
    }

    // ---------- Save schedule ----------
    async function saveSchedule() {
      if (!currentSchedule?.id) return;

      try {
        const payload = {
          matches: (currentSchedule.matches || []).map(m => ({
            matchId: m.matchId,
            date: m.date,
            status: m.status ?? "scheduled",
            result: m.result ?? null,
            notes: m.notes ?? "",
            player1Id: m.player1Id ?? null,
            player2Id: m.player2Id ?? null
          }))
        };

        const saved = await api(`/schedules/${currentSchedule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        renderSchedule(saved);
        setScheduleDirty(false);
        await loadSchedules({ keepCurrent: true });
      } catch (err) {
        console.error(err);
        alert("Save schedule failed. Check console/logs.");
      }
    }

    function clearScheduleDisplay() {
      document.getElementById("printTitle").textContent = "Schedule";
      document.getElementById("printMeta").textContent = "No saved schedules yet.";
      document.querySelector("#printTable tbody").innerHTML = "";
      setScheduleDirty(false);
    }

    // ---------- Init ----------
    document.addEventListener("DOMContentLoaded", async () => {
      await loadPlayers();
      await loadSchedules();
    });
=======

    // ---------- Global state ----------
    let currentSchedule = null;
    let allPlayers = [];
    let scheduleDirty = false;

    // ---------- DOM refs ----------
    const form = document.getElementById("playerForm");
    const scheduleList = document.getElementById("scheduleList");

    const btnGenerate = document.getElementById("btnGenerate");
    const btnFilter = document.getElementById("btnFilter");
    const btnClearFilter = document.getElementById("btnClearFilter");
    const btnPrint = document.getElementById("btnPrint");
    const btnSaveSchedule = document.getElementById("btnSaveSchedule");

    // Modal refs
    const modalBackdrop = document.getElementById("modalBackdrop");
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const modalForm = document.getElementById("modalForm");
    const modalClose = document.getElementById("modalClose");
    const modalCancel = document.getElementById("modalCancel");

    let modalOnSubmit = null;

    // ---------- API helper ----------
    async function api(url, options) {
      const res = await fetch(url, options);
      if (!res.ok) {
        let details = "";
        try { details = await res.text(); } catch (_) {}
        throw new Error(`${options?.method || "GET"} ${url} failed: ${res.status} ${details}`);
      }
      return res.json();
    }

    // ---------- Helpers ----------
    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function formatScore(v) {
      const n = Number(v ?? 0);
      return Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, "").replace(/\.$/, "");
    }

    function setScheduleDirty(isDirty) {
      scheduleDirty = isDirty;

      const status = document.getElementById("scheduleStatus");
      if (btnSaveSchedule) btnSaveSchedule.disabled = !isDirty;

      if (status) {
        status.textContent = isDirty ? "Unsaved changes" : "Saved";
        status.style.color = isDirty ? "#22c55e" : "rgba(233,238,252,0.75)";
      }
    }

    function getPlayerMapByLevel(level) {
      const list = allPlayers.filter(p => Number(p.level) === Number(level));
      const byId = new Map(list.map(p => [Number(p.id), p]));
      return { list, byId };
    }

    function playerNameFromId(level, id) {
      if (id === null || id === undefined) return "BYE";
      const { byId } = getPlayerMapByLevel(level);
      return byId.get(Number(id))?.name || "Unknown";
    }

    function buildPlayerIdOptions(level, selectedId) {
      const { list } = getPlayerMapByLevel(level);
      const sel = selectedId === null || selectedId === undefined ? "" : String(selectedId);

      const opts = list
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(p => `<option value="${escapeHtml(p.id)}" ${String(p.id) === sel ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("");

      return `<option value="" ${sel === "" ? "selected" : ""}>BYE</option>` + opts;
    }

    // ---------- Modal helpers ----------
    function openModal({ title, bodyHtml, onSubmit }) {
      modalTitle.textContent = title;
      modalBody.innerHTML = bodyHtml;
      modalOnSubmit = onSubmit;

      modalBackdrop.classList.remove("hidden");
      modalBackdrop.setAttribute("aria-hidden", "false");

      const first = modalBody.querySelector("input, select, textarea, button");
      if (first) first.focus();
    }

    function closeModal() {
      modalBackdrop.classList.add("hidden");
      modalBackdrop.setAttribute("aria-hidden", "true");
      modalBody.innerHTML = "";
      modalOnSubmit = null;
    }

    modalClose?.addEventListener("click", closeModal);
    modalCancel?.addEventListener("click", closeModal);

    modalBackdrop?.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalBackdrop && !modalBackdrop.classList.contains("hidden")) {
        closeModal();
      }
    });

    modalForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (typeof modalOnSubmit === "function") {
        await modalOnSubmit(new FormData(modalForm));
      }
    });

    // ---------- Players ----------
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("name").value.trim();
      const level = document.getElementById("level").value;

      try {
        const players = await api("/add-player", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, level })
        });

        allPlayers = Array.isArray(players) ? players : [];
        renderPlayers(allPlayers);
        form.reset();
      } catch (err) {
        console.error(err);
        alert("Add player failed. Check console/logs.");
      }
    });

    async function loadPlayers() {
      try {
        const players = await api("/players");
        allPlayers = Array.isArray(players) ? players : [];
        renderPlayers(allPlayers);
      } catch (err) {
        console.error(err);
        allPlayers = [];
        renderPlayers([]);
      }
    }

    function renderPlayers(players) {
      const tbody = document.querySelector("#playerTable tbody");
      if (!tbody) return;

      tbody.innerHTML = "";

      const sorted = [...(players || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      sorted.forEach((p, index) => {
        const tr = document.createElement("tr");

        const tdRank = document.createElement("td");
        tdRank.textContent = index + 1;

        const tdName = document.createElement("td");
        tdName.textContent = p.name;

        const tdLevel = document.createElement("td");
        tdLevel.textContent = p.level;

        const tdScore = document.createElement("td");
        tdScore.textContent = formatScore(p.score);

        const tdActions = document.createElement("td");
        tdActions.className = "no-print";

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.className = "admin-btn";
        editBtn.addEventListener("click", () => editPlayer(p.id, p.name, p.level, p.score ?? 0));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "admin-btn btn-danger";
        deleteBtn.addEventListener("click", () => deletePlayer(p.id, deleteBtn));

        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);

        tr.appendChild(tdRank);
        tr.appendChild(tdName);
        tr.appendChild(tdLevel);
        tr.appendChild(tdScore);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    }

    async function deletePlayer(id, btn) {
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Deleting…";
        }
        await api(`/players/${id}`, { method: "DELETE" });
        await loadPlayers();

        if (currentSchedule) renderSchedule(currentSchedule);
      } catch (err) {
        console.error(err);
        alert("Delete failed. Player may be involved in a scheduled match. Check console.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Delete";
        }
      }
    }

    function editPlayer(id, currentName, currentLevel, currentScore) {
      openModal({
        title: "Edit Player",
        bodyHtml: `
          <div class="field">
            <label for="mp_name">Name</label>
            <input id="mp_name" name="name" type="text" value="${escapeHtml(currentName)}" required />
          </div>

          <div class="field">
            <label for="mp_level">Level</label>
            <select id="mp_level" name="level">
              <option value="1" ${String(currentLevel) === "1" ? "selected" : ""}>Level 1</option>
              <option value="2" ${String(currentLevel) === "2" ? "selected" : ""}>Level 2</option>
              <option value="3" ${String(currentLevel) === "3" ? "selected" : ""}>Level 3</option>
            </select>
          </div>

          <div class="field">
            <label for="mp_score">Score</label>
            <input id="mp_score" name="score" type="number" step="0.5" value="${escapeHtml(currentScore ?? 0)}" />
          </div>
        `,
        onSubmit: async (fd) => {
          const name = fd.get("name").toString().trim();
          const level = fd.get("level").toString();
          const score = fd.get("score").toString();

          try {
            await api(`/players/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, level, score })
            });

            closeModal();
            await loadPlayers();
            if (currentSchedule) renderSchedule(currentSchedule);
          } catch (err) {
            console.error(err);
            alert("Save player failed. Check console.");
          }
        }
      });
    }

    // ---------- Schedules ----------
    btnGenerate?.addEventListener("click", generateSchedule);
    btnFilter?.addEventListener("click", applyDateFilter);
    btnClearFilter?.addEventListener("click", clearDateFilter);
    btnPrint?.addEventListener("click", () => window.print());
    btnSaveSchedule?.addEventListener("click", saveSchedule);

    // ✅ FIX #1: define addScheduleToList at top-level (it was incorrectly nested inside loadSchedules)
    function addScheduleToList(s, { prepend = false } = {}) {
      const li = document.createElement("li");
      li.textContent = `Schedule ${s.createdAt} `;

      const viewBtn = document.createElement("button");
      viewBtn.textContent = "View";
      viewBtn.className = "admin-btn";
      viewBtn.addEventListener("click", () => viewSchedule(s.id));

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.className = "admin-btn btn-danger";
      deleteBtn.addEventListener("click", () => deleteSchedule(s.id, deleteBtn));

      li.appendChild(viewBtn);
      li.appendChild(deleteBtn);

      if (prepend && scheduleList.firstChild) scheduleList.insertBefore(li, scheduleList.firstChild);
      else scheduleList.appendChild(li);
    }

    async function generateSchedule() {
      try {
        // optional but helpful so the edit dropdowns have latest roster
        await loadPlayers();

        const newSchedule = await api("/schedule", { method: "POST" });

        // Show the schedule immediately
        renderSchedule(newSchedule);

        // ✅ FIX #2: this now works because addScheduleToList is in scope
        addScheduleToList({ id: newSchedule.id, createdAt: newSchedule.createdAt }, { prepend: true });

        document.getElementById("printArea")?.scrollIntoView({ behavior: "smooth" });

        // Optional: refresh list from server (safe even if it fails)
        loadSchedules({ keepCurrent: true }).catch(() => {});
      } catch (err) {
        console.error(err);
        alert("Generate schedule failed. Check console/logs.");
      }
    }

    async function loadSchedules({ keepCurrent = false } = {}) {
      try {
        const schedules = await api("/schedules");
        const list = Array.isArray(schedules) ? schedules : [];

        scheduleList.innerHTML = "";

        list.forEach((s) => addScheduleToList(s, { prepend: false }));

        // Only auto-load a schedule if we aren't editing unsaved changes
        if (!keepCurrent && !scheduleDirty) {
          if (list.length > 0) await viewSchedule(list[list.length - 1].id);
          else clearScheduleDisplay();
        }

        if (list.length === 0) clearScheduleDisplay();
      } catch (err) {
        console.error(err);
        clearScheduleDisplay();
      }
    }

    async function viewSchedule(id) {
      if (scheduleDirty && !confirm("You have unsaved changes. Switch schedules anyway?")) return;

      try {
        if (!allPlayers.length) await loadPlayers();

        const schedule = await api(`/schedules/${id}`);
        renderSchedule(schedule);
        document.getElementById("printArea")?.scrollIntoView({ behavior: "smooth" });
      } catch (err) {
        console.error(err);
        alert("View schedule failed. Check console/logs.");
      }
    }

    async function deleteSchedule(id, btn) {
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Deleting…";
        }
        await api(`/schedules/${id}`, { method: "DELETE" });

        if (currentSchedule?.id === Number(id) || String(currentSchedule?.id) === String(id)) {
          currentSchedule = null;
          setScheduleDirty(false);
        }

        await loadSchedules({ keepCurrent: true });
      } catch (err) {
        console.error(err);
        alert("Delete schedule failed. Check console/logs.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Delete";
        }
      }
    }

    function normalizeMatchesForUI(matches) {
      return (matches || []).map(m => ({
        ...m,
        player1Id: m.player1Id === null || m.player1Id === undefined ? null : Number(m.player1Id),
        player2Id: m.player2Id === null || m.player2Id === undefined ? null : Number(m.player2Id),
        player1: m.player1 ?? playerNameFromId(m.level, m.player1Id),
        player2: m.player2 ?? playerNameFromId(m.level, m.player2Id),
      }));
    }

    function renderSchedule(schedule) {
      currentSchedule = {
        ...schedule,
        matches: normalizeMatchesForUI(schedule?.matches || [])
      };

      document.getElementById("printTitle").textContent = "Round Robin Schedule";
      document.getElementById("printMeta").textContent =
        `Created: ${currentSchedule.createdAt} | Matches: ${currentSchedule.matches.length}`;

      renderMatches(currentSchedule.matches);
      setScheduleDirty(false);
    }

    // ---------- Render Matches ----------
    function renderMatches(matches) {
      const tbody = document.querySelector("#printTable tbody");
      if (!tbody) return;

      tbody.innerHTML = "";
      if (!matches || matches.length === 0) return;

      const sorted = [...matches].sort((a, b) => {
        if (Number(a.level) !== Number(b.level)) return Number(a.level) - Number(b.level);
        const dc = String(a.date).localeCompare(String(b.date));
        if (dc !== 0) return dc;
        return String(a.matchId).localeCompare(String(b.matchId));
      });

      let currentLevel = null;

      sorted.forEach(m => {
        if (m.level !== currentLevel) {
          currentLevel = m.level;

          const levelRow = document.createElement("tr");
          levelRow.className = "level-divider";

          const td = document.createElement("td");
          td.colSpan = 5;
          td.textContent = `Level ${currentLevel}`;
          td.className = "level-header";

          levelRow.appendChild(td);
          tbody.appendChild(levelRow);
        }

        const tr = document.createElement("tr");

        const tdDate = document.createElement("td");
        tdDate.textContent = m.date;

        const tdLevel = document.createElement("td");
        tdLevel.textContent = `Level ${m.level}`;

        const tdPlayer = document.createElement("td");
        tdPlayer.textContent = m.player1 ?? playerNameFromId(m.level, m.player1Id);

        const tdOpponent = document.createElement("td");
        tdOpponent.textContent = m.player2 ?? playerNameFromId(m.level, m.player2Id);

        const tdActions = document.createElement("td");
        tdActions.className = "no-print";

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.className = "admin-btn";
        editBtn.addEventListener("click", () => editMatch(m));

        tdActions.appendChild(editBtn);

        tr.appendChild(tdDate);
        tr.appendChild(tdLevel);
        tr.appendChild(tdPlayer);
        tr.appendChild(tdOpponent);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    }

    // ---------- Filter by date ----------
    function applyDateFilter() {
      if (!currentSchedule) return;

      const selected = document.getElementById("filterDate").value;
      if (!selected) return;

      const filtered = (currentSchedule.matches || []).filter(m => m.date === selected);

      document.getElementById("printMeta").textContent =
        `Matches on ${selected} | Count: ${filtered.length}`;

      renderMatches(filtered);
    }

    function clearDateFilter() {
      if (!currentSchedule) return;

      document.getElementById("filterDate").value = "";
      document.getElementById("printMeta").textContent =
        `Created: ${currentSchedule.createdAt} | Matches: ${currentSchedule.matches.length}`;

      renderMatches(currentSchedule.matches);
    }

    // ---------- Edit match (draft-only; edits IDs so PUT works) ----------
    function editMatch(m) {
      if (!currentSchedule) return;
      if (!m.matchId) {
        alert("This schedule/match is missing matchId. Generate a new schedule.");
        return;
      }

      openModal({
        title: "Edit Match",
        bodyHtml: `
          <div class="field">
            <label for="mm_date">Date</label>
            <input id="mm_date" name="date" type="date" value="${escapeHtml(m.date)}" required />
          </div>

          <div class="field">
            <label for="mm_player1Id">Player</label>
            <select id="mm_player1Id" name="player1Id">
              ${buildPlayerIdOptions(m.level, m.player1Id)}
            </select>
          </div>

          <div class="field">
            <label for="mm_player2Id">Opponent</label>
            <select id="mm_player2Id" name="player2Id">
              ${buildPlayerIdOptions(m.level, m.player2Id)}
            </select>
          </div>

          <div class="field">
            <label for="mm_status">Status</label>
            <select id="mm_status" name="status">
              ${["scheduled", "completed", "forfeit", "canceled"].map(s =>
                `<option value="${s}" ${m.status === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </div>

          <div class="field">
            <label for="mm_result">Result (optional)</label>
            <input id="mm_result" name="result" type="text"
              placeholder="e.g. 1-0, 0-1, 0.5-0.5"
              value="${escapeHtml(m.result ?? "")}" />
          </div>

          <div class="field">
            <label for="mm_notes">Notes (optional)</label>
            <textarea id="mm_notes" name="notes">${escapeHtml(m.notes ?? "")}</textarea>
          </div>
        `,
        onSubmit: async (fd) => {
          const date = fd.get("date").toString();
          const player1IdRaw = fd.get("player1Id").toString();
          const player2IdRaw = fd.get("player2Id").toString();
          const status = fd.get("status").toString();
          const result = fd.get("result").toString().trim() || null;
          const notes = fd.get("notes").toString().trim() || "";

          const player1Id = player1IdRaw ? Number(player1IdRaw) : null;
          const player2Id = player2IdRaw ? Number(player2IdRaw) : null;

          if (player1Id && player2Id && player1Id === player2Id) {
            alert("Player and Opponent cannot be the same.");
            return;
          }

          const idx = (currentSchedule.matches || []).findIndex(x => x.matchId === m.matchId);
          if (idx === -1) {
            alert("Match not found in current schedule.");
            return;
          }

          const updatedMatch = {
            ...currentSchedule.matches[idx],
            date,
            player1Id,
            player2Id,
            player1: playerNameFromId(m.level, player1Id),
            player2: playerNameFromId(m.level, player2Id),
            status,
            result,
            notes
          };

          currentSchedule.matches[idx] = updatedMatch;

          closeModal();
          document.getElementById("printMeta").textContent =
            `Created: ${currentSchedule.createdAt} | Matches: ${currentSchedule.matches.length}`;
          renderMatches(currentSchedule.matches);
          setScheduleDirty(true);
        }
      });
    }

    // ---------- Save schedule ----------
    async function saveSchedule() {
      if (!currentSchedule?.id) return;

      try {
        const payload = {
          matches: (currentSchedule.matches || []).map(m => ({
            matchId: m.matchId,
            date: m.date,
            status: m.status ?? "scheduled",
            result: m.result ?? null,
            notes: m.notes ?? "",
            player1Id: m.player1Id ?? null,
            player2Id: m.player2Id ?? null
          }))
        };

        const saved = await api(`/schedules/${currentSchedule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        renderSchedule(saved);
        setScheduleDirty(false);
        await loadSchedules({ keepCurrent: true });
      } catch (err) {
        console.error(err);
        alert("Save schedule failed. Check console/logs.");
      }
    }

    function clearScheduleDisplay() {
      document.getElementById("printTitle").textContent = "Schedule";
      document.getElementById("printMeta").textContent = "No saved schedules yet.";
      document.querySelector("#printTable tbody").innerHTML = "";
      setScheduleDirty(false);
    }

    // ---------- Init ----------
    document.addEventListener("DOMContentLoaded", async () => {
      await loadPlayers();
      await loadSchedules();
    });
>>>>>>> 5ee508736eb8ff20421ad9f7a0fdfcd676228274
