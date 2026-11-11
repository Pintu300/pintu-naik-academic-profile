const recoveryForm = document.querySelector("[data-recovery-form]");
const recoveryStatus = document.querySelector("[data-recovery-status]");
const requestButton = document.querySelector("[data-request-code]");
const resetButton = recoveryForm.querySelector("[type='submit']");
const recoveryLogin = document.querySelector("[data-recovery-login]");
let cooldownUntil = 0;
let busy = false;
const updateButtons = () => {
  const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  requestButton.disabled = busy || seconds > 0;
  resetButton.disabled = busy;
  requestButton.textContent = seconds ? `Send again in ${seconds}s` : "Send recovery code";
};
const recoveryCall = async (action, data) => {
  const response = await fetch(`/api/auth/recovery/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor" }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Recovery failed. Try again.");
  return result;
};
const showRecoveryStatus = (text, status = "info") => { recoveryStatus.textContent = text; recoveryStatus.dataset.status = status; };
requestButton.addEventListener("click", async () => {
  if (busy || cooldownUntil > Date.now() || !recoveryForm.elements.email.reportValidity()) return;
  busy = true; updateButtons();
  try {
    showRecoveryStatus("Requesting a recovery code…");
    const result = await recoveryCall("request", { email: recoveryForm.elements.email.value.trim() });
    showRecoveryStatus(result.message);
    cooldownUntil = Date.now() + 60000;
    recoveryForm.elements.code.value = "";
    recoveryForm.elements.code.focus();
    const timer = window.setInterval(() => { updateButtons(); if (Date.now() >= cooldownUntil) window.clearInterval(timer); }, 1000);
  } catch (error) { showRecoveryStatus(error.message, "error"); }
  finally { busy = false; updateButtons(); }
});
recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  if (recoveryForm.elements.password.value !== recoveryForm.elements.confirmPassword.value) {
    showRecoveryStatus("The new passwords do not match.", "error"); return;
  }
  busy = true; updateButtons();
  try {
    const result = await recoveryCall("reset", Object.fromEntries(["email", "code", "password", "confirmPassword"].map((key) => [key, key === "email" ? recoveryForm.elements[key].value.trim() : recoveryForm.elements[key].value])));
    showRecoveryStatus(`${result.message} Your username is: ${result.username}`, "success");
    recoveryForm.elements.password.value = "";
    recoveryForm.elements.confirmPassword.value = "";
    recoveryForm.elements.code.value = "";
    recoveryLogin.hidden = false;
    recoveryLogin.focus();
  } catch (error) { showRecoveryStatus(error.message, "error"); }
  finally { busy = false; updateButtons(); }
});
