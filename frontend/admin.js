const form = document.querySelector("[data-editor-form]");
const statusElement = document.querySelector("[data-editor-status]");

let siteData = null;

const setStatus = (message, type = "info") => {
  statusElement.textContent = message;
  statusElement.dataset.status = type;
};

const getValue = (path) => path.split(".").reduce((value, key) => value?.[key], siteData);

const setValue = (path, value) => {
  const keys = path.split(".");
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => current[key], siteData);
  target[lastKey] = value;
};

const fillForm = () => {
  form.querySelectorAll("input, textarea").forEach((field) => {
    if (field.name === "profile.about") {
      field.value = JSON.stringify(siteData.profile.about, null, 2);
      return;
    }

    if (["research", "updates", "publications", "projects", "achievements", "education", "skills", "teaching"].includes(field.name)) {
      field.value = JSON.stringify(siteData[field.name], null, 2);
      return;
    }

    field.value = getValue(field.name) || "";
  });
};

const readForm = () => {
  form.querySelectorAll("input, textarea").forEach((field) => {
    if (field.name === "profile.about") {
      siteData.profile.about = JSON.parse(field.value);
      return;
    }

    if (["research", "updates", "publications", "projects", "achievements", "education", "skills", "teaching"].includes(field.name)) {
      siteData[field.name] = JSON.parse(field.value);
      return;
    }

    setValue(field.name, field.value.trim());
  });
};

const loadData = async () => {
  const response = await fetch("/api/admin/site-data");

  if (!response.ok) {
    throw new Error("Could not load website details.");
  }

  siteData = await response.json();
  fillForm();
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving...");

  try {
    readForm();

    const response = await fetch("/api/admin/site-data", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(siteData)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Save failed.");
    }

    setStatus("Saved. Refresh the main website to see your changes.", "success");
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  }
});

loadData().catch((error) => {
  setStatus(`Error: ${error.message}`, "error");
});
