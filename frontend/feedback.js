(function () {
  const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "http://localhost:8000";

  const form = document.getElementById("feedbackForm");
  const typeEl = document.getElementById("type");
  const messageEl = document.getElementById("message");
  const emailEl = document.getElementById("email");
  const submitBtn = document.getElementById("submitBtn");
  const btnSpinner = document.getElementById("btnSpinner");
  const btnText = document.getElementById("btnText");
  const resultMsg = document.getElementById("resultMsg");
  const charCount = document.getElementById("charCount");

  messageEl.addEventListener("input", function () {
    charCount.textContent = this.value.length;
  });

  function setLoading(isLoading) {
    if (isLoading) {
      submitBtn.classList.add("loading");
      btnSpinner.classList.add("visible");
      btnText.textContent = "Submitting...";
      submitBtn.disabled = true;
    } else {
      submitBtn.classList.remove("loading");
      btnSpinner.classList.remove("visible");
      btnText.textContent = "Submit Feedback";
      submitBtn.disabled = false;
    }
  }

  function showMessage(text, type) {
    resultMsg.className = "msg " + type;
    resultMsg.textContent = text;
    resultMsg.style.display = "block";
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    resultMsg.className = "msg";
    resultMsg.style.display = "none";
    setLoading(true);

    const body = {
      type: typeEl.value,
      message: messageEl.value.trim(),
    };
    const email = emailEl.value.trim();
    if (email) {
      body.email = email;
    }

    try {
      const res = await fetch(API_BASE + "/api/feedback/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        showMessage("\u2713 Thank you! Your feedback has been submitted.", "success");
        form.reset();
        charCount.textContent = "0";
      } else {
        const err = await res.json();
        showMessage("\u2717 " + (err.detail || "Something went wrong. Please try again."), "error");
      }
    } catch {
      showMessage("\u2717 Network error. Check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  });
})();
