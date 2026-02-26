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

    // ---------- Helpers ----------
    function escapeHtml(str) {
      return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

    modalClose.addEventListener("click", closeModal);
    modalCancel.addEventListener("click", closeModal);

    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modalBackdrop.classList.contains("hidden")) {
        closeModal();
      }
    });

    modalForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (typeof modalOnSubmit === "function") {
        await modalOnSubmit(new FormData(modalForm));
      }
    });

    // ---------- Players ----------
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("name").value.trim();
      const level = document.getElementById("level").value;

      const response = await fetch("/add-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, level })
      });

      const players = await response.json();
      allPlayers = players;
      renderPlayers(players);
      form.reset();
    });

    async function loadPlayers() {
      const response = await fetch("/players");
      const players = await response.json();
      allPlayers = players;
      renderPlayers(players);
    }

    function renderPlayers(players) {
      const tbody = document.querySelector("#playerTable tbody");
      tbody.innerHTML = "";

      const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      sorted.forEach((p, index) => {
        const tr = document.createElement("tr");

        const tdRank = document.createElement("td");
        tdRank.textContent = index + 1;

        const tdName = document.createElement("td");
        tdName.textContent = p.name;

        const tdLevel = document.createElement("td");
        tdLevel.textContent = p.level;

        const tdScore = document.createElement("td");
        tdScore.textContent = p.score ?? 0;

        const tdActions = document.createElement("td");
        tdActions.className = "no-print";

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.className = "admin-btn";
        editBtn.addEventListener("click", () => editPlayer(p.id, p.name, p.level, p.score ?? 0));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "admin-btn btn-danger";
        deleteBtn.addEventListener("click", () => deletePlayer(p.id));

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

    async function deletePlayer(id) {
      await fetch(`/players/${id}`, { method: "DELETE" });
      loadPlayers();
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
            <input id="mp_score" name="score" type="number" step="0.5" value="${currentScore ?? 0}" />
          </div>
        `,
        onSubmit: async (fd) => {
          const name = fd.get("name").toString().trim();
          const level = fd.get("level").toString();
          const score = fd.get("score").toString();

          await fetch(`/players/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, level, score })
          });

          closeModal();
          loadPlayers();
        }
      });
    }

    function getPlayerNamesByLevel(level) {
      return allPlayers
        .filter(p => Number(p.level) === Number(level))
        .map(p => p.name)
        .sort((a, b) => a.localeCompare(b));
    }

    function buildOptions(names, selected) {
      return names.map(n =>
        `<option value="${escapeHtml(n)}" ${n === selected ? "selected" : ""}>${escapeHtml(n)}</option>`
      ).join("");
    }

    // ---------- Schedules ----------
    btnGenerate.addEventListener("click", generateSchedule);
    btnFilter.addEventListener("click", applyDateFilter);
    btnClearFilter.addEventListener("click", clearDateFilter);
    btnPrint.addEventListener("click", () => window.print());
    btnSaveSchedule.addEventListener("click", saveSchedule);

    async function generateSchedule() {
      const res = await fetch("/schedule", { method: "POST" });
      const newSchedule = await res.json();

      renderSchedule(newSchedule);
      loadSchedules();
    }

    async function loadSchedules() {
      const res = await fetch("/schedules");
      const schedules = await res.json();

      scheduleList.innerHTML = "";

      schedules.forEach(s => {
        const li = document.createElement("li");
        li.textContent = `Schedule ${s.createdAt} `;

        const viewBtn = document.createElement("button");
        viewBtn.textContent = "View";
        viewBtn.className = "admin-btn";
        viewBtn.addEventListener("click", () => viewSchedule(s.id));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "admin-btn btn-danger";
        deleteBtn.addEventListener("click", async () => {
          await deleteSchedule(s.id);
        });

        li.appendChild(viewBtn);
        li.appendChild(deleteBtn);
        scheduleList.appendChild(li);
      });

      if (schedules.length > 0) {
        await viewSchedule(schedules[schedules.length - 1].id);
      } else {
        clearScheduleDisplay();
      }
    }

    async function viewSchedule(id) {
      if (scheduleDirty && !confirm("You have unsaved changes. Switch schedules anyway?")) {
        return;
      }

      const res = await fetch(`/schedules/${id}`);
      const schedule = await res.json();

      renderSchedule(schedule);
      document.getElementById("printArea").scrollIntoView({ behavior: "smooth" });
    }

    async function deleteSchedule(id) {
      await fetch(`/schedules/${id}`, { method: "DELETE" });
      await loadSchedules();
    }

    function renderSchedule(schedule) {
      currentSchedule = schedule;

      document.getElementById("printTitle").textContent = "Round Robin Schedule";
      document.getElementById("printMeta").textContent =
        `Created: ${schedule.createdAt} | Matches: ${schedule.matches.length}`;

      renderMatches(schedule.matches);
      setScheduleDirty(false);
    }

    function renderMatches(matches) {
      const tbody = document.querySelector("#printTable tbody");
      tbody.innerHTML = "";

      matches.forEach(m => {
        const tr = document.createElement("tr");

        const tdDate = document.createElement("td");
        tdDate.textContent = m.date;

        const tdLevel = document.createElement("td");
        tdLevel.textContent = `Level ${m.level}`;

        const tdPlayer = document.createElement("td");
        tdPlayer.textContent = m.player1;

        const tdOpponent = document.createElement("td");
        tdOpponent.textContent = m.player2;

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

    function applyDateFilter() {
      if (!currentSchedule) return;

      const selected = document.getElementById("filterDate").value;
      if (!selected) return;

      const filtered = currentSchedule.matches.filter(m => m.date === selected);

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

    function editMatch(m) {
      if (!currentSchedule) return;

      if (!m.matchId) {
        alert("This schedule/match is missing matchId. Generate a new schedule.");
        return;
      }

      const names = getPlayerNamesByLevel(m.level);

      openModal({
        title: "Edit Match",
        bodyHtml: `
          <div class="field">
            <label for="mm_date">Date</label>
            <input id="mm_date" name="date" type="date" value="${escapeHtml(m.date)}" required />
          </div>

          <div class="field">
            <label for="mm_player1">Player</label>
            <select id="mm_player1" name="player1">
              ${buildOptions(names, m.player1)}
            </select>
          </div>

          <div class="field">
            <label for="mm_player2">Opponent</label>
            <select id="mm_player2" name="player2">
              ${buildOptions(names, m.player2)}
            </select>
          </div>

          <div class="field">
            <label for="mm_status">Status</label>
            <select id="mm_status" name="status">
              ${["scheduled","completed","forfeit","canceled"].map(s =>
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
          const player1 = fd.get("player1").toString();
          const player2 = fd.get("player2").toString();
          const status = fd.get("status").toString();
          const result = fd.get("result").toString().trim() || null;
          const notes = fd.get("notes").toString().trim() || "";

          if (player1 === player2) {
            alert("Player and Opponent cannot be the same.");
            return;
          }

          // Draft update only (no server call here)
          const idx = currentSchedule.matches.findIndex(x => x.matchId === m.matchId);
          if (idx === -1) {
            alert("Match not found in current schedule.");
            return;
          }

          currentSchedule.matches[idx] = {
            ...currentSchedule.matches[idx],
            date,
            player1,
            player2,
            status,
            result,
            notes
          };

          closeModal();
          renderSchedule(currentSchedule);
          setScheduleDirty(true);
        }
      });
    }

    async function saveSchedule() {
      if (!currentSchedule?.id) return;

      const res = await fetch(`/schedules/${currentSchedule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentSchedule)
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("Save schedule failed:", res.status, txt);
        alert("Save failed. Check console.");
        return;
      }

      const saved = await res.json();
      currentSchedule = saved;

      renderSchedule(saved);
      setScheduleDirty(false);
      loadSchedules();
    }

    function clearScheduleDisplay() {
      document.getElementById("printTitle").textContent = "Schedule";
      document.getElementById("printMeta").textContent = "No saved schedules yet.";
      document.querySelector("#printTable tbody").innerHTML = "";
      setScheduleDirty(false);
    }

    // ---------- Init ----------
    document.addEventListener("DOMContentLoaded", () => {
      loadPlayers();
      loadSchedules();
    });