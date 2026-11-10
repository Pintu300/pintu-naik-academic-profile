const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");
const submitButton = loginForm.querySelector("[type='submit']");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  loginStatus.dataset.status = "info";
  loginStatus.textContent = "Signing in…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor" },
      body: JSON.stringify({ username: loginForm.elements.username.value.trim(), password: loginForm.elements.password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign in failed. Please try again.");
    loginForm.elements.password.value = "";
    window.location.replace("/admin.html");
  } catch (error) {
    loginStatus.dataset.status = "error";
    loginStatus.textContent = error.message;
    loginForm.elements.password.value = "";
    loginForm.elements.password.focus();
    submitButton.disabled = false;
  }
});
