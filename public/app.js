const uploadForm = document.querySelector("#uploadForm");
const titleInput = document.querySelector("#titleInput");
const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const selectedFiles = document.querySelector("#selectedFiles");
const projectList = document.querySelector("#projectList");
const projectCount = document.querySelector("#projectCount");
const readerPages = document.querySelector("#readerPages");
const readerTitle = document.querySelector("#readerTitle");
const readerMeta = document.querySelector("#readerMeta");
const refreshButton = document.querySelector("#refreshButton");
const backButton = document.querySelector("#backButton");
const fitButton = document.querySelector("#fitButton");
const readerExitButton = document.querySelector("#readerExitButton");
const networkUrls = document.querySelector("#networkUrls");

let projects = [];
let currentProjectId = null;

await Promise.all([loadProjects(), loadNetworkUrls()]);
const initialProjectId = new URLSearchParams(location.search).get("project");
if (initialProjectId) {
  openProject(initialProjectId, { replace: true });
}

refreshButton.addEventListener("click", loadProjects);
backButton.addEventListener("click", closeReader);
readerExitButton.addEventListener("click", closeReader);

fitButton.addEventListener("click", () => {
  readerPages.classList.toggle("is-full");
  fitButton.textContent = readerPages.classList.contains("is-full") ? "標準" : "幅";
});

window.addEventListener("popstate", () => {
  const id = new URLSearchParams(location.search).get("project");
  if (id) {
    openProject(id, { replace: true, scroll: false });
  } else {
    exitReadingMode();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("is-reading")) {
    closeReader();
  }
});

fileInput.addEventListener("change", updateSelectedFiles);

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  fileInput.files = event.dataTransfer.files;
  updateSelectedFiles();
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...fileInput.files].filter((file) => /\.jpe?g$/i.test(file.name));
  if (files.length === 0) {
    selectedFiles.textContent = "JPEGファイルを選択してください。";
    return;
  }

  const submitButton = uploadForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "アップロード中...";

  try {
    const formData = new FormData();
    formData.append("title", titleInput.value);
    for (const file of files) {
      formData.append("pages", file);
    }

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const project = await response.json();
    if (!response.ok) {
      throw new Error(project.error || "アップロードに失敗しました。");
    }

    fileInput.value = "";
    titleInput.value = "";
    updateSelectedFiles();
    await loadProjects();
    openProject(project.id);
  } catch (error) {
    selectedFiles.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "アップロードして読む";
  }
});

async function loadProjects() {
  const response = await fetch("/api/projects");
  projects = await response.json();
  renderProjects();
}

async function loadNetworkUrls() {
  const response = await fetch("/api/network");
  const data = await response.json();
  networkUrls.innerHTML = "";
  for (const url of data.urls) {
    const link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    networkUrls.append(link);
  }
}

function renderProjects() {
  projectCount.textContent = `${projects.length}件`;
  projectList.innerHTML = "";

  if (projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "selected-files";
    empty.textContent = "まだ保存された原稿はありません。";
    projectList.append(empty);
    return;
  }

  for (const project of projects) {
    const button = document.createElement("button");
    button.className = "project-card";
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(project.title)}</strong>
      <p>${project.pageCount}ページ / ${formatDate(project.createdAt)}</p>
    `;
    button.addEventListener("click", () => openProject(project.id));
    projectList.append(button);
  }
}

async function openProject(id, options = {}) {
  let project = projects.find((item) => item.id === id);
  if (!project) {
    const response = await fetch(`/api/projects/${id}`);
    if (!response.ok) return;
    project = await response.json();
  }

  currentProjectId = project.id;
  if (options.replace) {
    history.replaceState(null, "", `/?project=${project.id}`);
  } else if (new URLSearchParams(location.search).get("project") !== project.id) {
    history.pushState(null, "", `/?project=${project.id}`);
  }

  readerTitle.textContent = project.title;
  readerMeta.textContent = `${project.pageCount}ページ`;
  readerPages.innerHTML = "";

  for (const page of project.pages) {
    const image = document.createElement("img");
    image.className = "page-image";
    image.src = page.url;
    image.alt = `${project.title} ${page.index + 1}ページ`;
    image.loading = page.index < 3 ? "eager" : "lazy";
    image.decoding = "async";
    readerPages.append(image);
  }

  enterReadingMode();
  if (options.scroll !== false) {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function closeReader() {
  history.pushState(null, "", "/");
  exitReadingMode();
}

function enterReadingMode() {
  document.body.classList.add("is-reading");
  document.body.classList.remove("is-library");
}

function exitReadingMode() {
  currentProjectId = null;
  document.body.classList.remove("is-reading");
  document.body.classList.add("is-library");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateSelectedFiles() {
  const files = [...fileInput.files].filter((file) => /\.jpe?g$/i.test(file.name));
  if (files.length === 0) {
    selectedFiles.textContent = "未選択";
    return;
  }
  const sorted = files.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  selectedFiles.textContent = `${sorted.length}ファイル: ${sorted.slice(0, 3).map((file) => file.name).join(", ")}${
    sorted.length > 3 ? " ..." : ""
  }`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[char];
  });
}
