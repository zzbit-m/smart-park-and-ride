(function () {
  const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "http://localhost:8000";

  const container = document.getElementById("feedbackTableContainer");
  const paginationEl = document.getElementById("pagination");
  const msgEl = document.getElementById("msg");
  const filterStatus = document.getElementById("filterStatus");
  const filterType = document.getElementById("filterType");
  const refreshBtn = document.getElementById("refreshBtn");

  let currentData = { items: [], total: 0, limit: 50, offset: 0 };

  function getToken() {
    return localStorage.getItem("adminToken");
  }

  function showMessage(text, type) {
    msgEl.className = "msg " + type;
    msgEl.textContent = text;
    msgEl.style.display = "block";
    setTimeout(function () {
      msgEl.style.display = "none";
    }, 4000);
  }

  async function loadFeedback() {
    const token = getToken();
    if (!token) {
      container.innerHTML =
        '<p class="no-data">Not logged in. Please log in from the <a href="admin.html" style="color:#81d4fa;">admin panel</a> first.</p>';
      return;
    }

    const params = new URLSearchParams();
    const status = filterStatus.value;
    const type = filterType.value;
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    params.set("limit", "50");
    params.set("offset", "0");

    container.innerHTML = '<p class="no-data">Loading...</p>';

    try {
      const res = await fetch(API_BASE + "/api/feedback/?" + params.toString(), {
        headers: { Authorization: "Bearer " + token },
      });

      if (res.status === 401 || res.status === 403) {
        container.innerHTML =
          '<p class="no-data">Session expired. Please <a href="admin.html" style="color:#81d4fa;">re-login</a>.</p>';
        return;
      }

      if (!res.ok) {
        container.innerHTML = '<p class="no-data">Failed to load feedback.</p>';
        return;
      }

      currentData = await res.json();
      renderTable();
    } catch {
      container.innerHTML = '<p class="no-data">Network error. Check your connection.</p>';
    }
  }

  function renderTable() {
    const { items, total, limit, offset } = currentData;

    if (!items || items.length === 0) {
      container.innerHTML = '<p class="no-data">No feedback entries found.</p>';
      paginationEl.textContent = "";
      return;
    }

    const start = offset + 1;
    const end = offset + items.length;

    let html =
      '<table><thead><tr>' +
      "<th>ID</th><th>Type</th><th>Message</th><th>Email</th><th>Status</th><th>Date</th><th>Action</th>" +
      "</tr></thead><tbody>";

    for (const item of items) {
      const statusClass = "status-badge status-" + item.status;
      html += "<tr>";
      html += "<td>" + item.id + "</td>";
      html += "<td>" + item.type + "</td>";
      html += '<td class="message-cell" title="' + escapeHtml(item.message) + '">' + escapeHtml(item.message) + "</td>";
      html += "<td>" + (item.email ? escapeHtml(item.email) : "—") + "</td>";
      html += '<td><span class="' + statusClass + '">' + item.status + "</span></td>";
      html += "<td>" + item.created_at + "</td>";
      html += '<td>' + renderStatusDropdown(item.id, item.status) + "</td>";
      html += "</tr>";
    }

    html += "</tbody></table>";
    container.innerHTML = html;

    paginationEl.textContent = "Showing " + start + "–" + end + " of " + total + " entries";

    // Attach event listeners to status dropdowns
    document.querySelectorAll(".save-status-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = parseInt(this.getAttribute("data-id"));
        const select = document.getElementById("status-select-" + id);
        const newStatus = select.value;
        updateStatus(id, newStatus);
      });
    });
  }

  function renderStatusDropdown(id, currentStatus) {
    const options = ["open", "reviewed", "closed"];
    let html = '<select id="status-select-' + id + '" class="status-select">';
    for (const opt of options) {
      const selected = opt === currentStatus ? " selected" : "";
      html += '<option value="' + opt + '"' + selected + ">" + opt + "</option>";
    }
    html += '</select> ';
    html +=
      '<button class="save-btn save-status-btn" data-id="' +
      id +
      '">Update</button>';
    return html;
  }

  async function updateStatus(id, newStatus) {
    const token = getToken();
    if (!token) {
      showMessage("Not logged in.", "error");
      return;
    }

    try {
      const res = await fetch(API_BASE + "/api/feedback/" + id, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        showMessage("Feedback #" + id + " updated to " + newStatus, "success");
        loadFeedback();
      } else if (res.status === 404) {
        showMessage("Feedback #" + id + " not found.", "error");
        loadFeedback();
      } else {
        const err = await res.json();
        showMessage(err.detail || "Update failed.", "error");
      }
    } catch {
      showMessage("Network error.", "error");
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  filterStatus.addEventListener("change", loadFeedback);
  filterType.addEventListener("change", loadFeedback);
  refreshBtn.addEventListener("click", loadFeedback);

  loadFeedback();
})();
