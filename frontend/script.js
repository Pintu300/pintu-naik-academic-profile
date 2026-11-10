const navigation = document.querySelector(".academic-header");
const menu = document.querySelector("#academic-menu");
const menuToggle = document.querySelector(".academic-nav__toggle");
const year = document.querySelector("[data-year]");

const setupRevealAnimations = () => {
  const targets = document.querySelectorAll("[data-reveal], main > .cv-section");
  if (!targets.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.body.classList.add("motion-ready");

  if (!("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach((target) => observer.observe(target));
};

setupRevealAnimations();

const setupAchievementDetails = () => {
  const modal = document.querySelector("[data-achievement-modal]");
  const gallery = document.querySelector("[data-achievements-list]");
  if (!modal || !gallery) return;

  const closeButton = modal.querySelector(".achievement-detail__close");
  let previouslyFocused = null;

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("achievement-detail-open");
    previouslyFocused?.focus();
  };

  gallery.addEventListener("click", (event) => {
    const card = event.target.closest("[data-achievement-index]");
    if (!card) return;

    const item = JSON.parse(card.dataset.achievement);
    previouslyFocused = card;
    modal.querySelector("[data-achievement-detail-image]").src = item.image;
    modal.querySelector("[data-achievement-detail-image]").alt = item.alt || item.title;
    modal.querySelector("[data-achievement-detail-meta]").textContent = [item.date, item.issuer]
      .filter(Boolean)
      .join(" · ");
    modal.querySelector("[data-achievement-detail-title]").textContent = item.title;
    modal.querySelector("[data-achievement-detail-description]").textContent = item.description || "";
    modal.querySelector("[data-achievement-detail-extra]").textContent = item.details || "";
    const link = modal.querySelector("[data-achievement-detail-link]");

    if (typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
      link.href = item.url;
      link.hidden = false;
    } else {
      link.hidden = true;
    }

    modal.hidden = false;
    document.body.classList.add("achievement-detail-open");
    closeButton.focus();
  });

  modal.querySelectorAll("[data-achievement-close]").forEach((button) => {
    button.addEventListener("click", close);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  }, true);
};

setupAchievementDetails();

if (year) {
  year.textContent = new Date().getFullYear();
}

if (navigation) {
  window.addEventListener(
    "scroll",
    () => navigation.classList.toggle("is-scrolled", window.scrollY > 8),
    { passive: true }
  );
}

if (menu && menuToggle) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menu.classList.toggle("is-open", !isOpen);
  });

  menu.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      menuToggle.setAttribute("aria-expanded", "false");
      menu.classList.remove("is-open");
    }
  });
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const renderList = (selector, items, renderItem) => {
  const container = document.querySelector(selector);
  if (!container || !Array.isArray(items)) return;
  container.innerHTML = items.map(renderItem).join("");
};

const renderRecords = (selector, items, renderItem, emptyMessage) => {
  const container = document.querySelector(selector);
  if (!container || !Array.isArray(items)) return;

  container.innerHTML = items.length
    ? items.map(renderItem).join("")
    : `<p class="academic-empty-state">${escapeHtml(emptyMessage)}</p>`;
};

const publicationCategoryLabels = {
  conference: "Conferences",
  journal: "Journals",
  bookChapter: "Book Chapters"
};
let publicationSortDescending = true;
let publicationItems = [];

const renderPublications = () => {
  const targets = document.querySelectorAll("[data-publications-category]");
  if (!targets.length) return;

  const sortedItems = [...publicationItems].sort((first, second) => {
    const firstYear = Number.parseInt(first.year, 10);
    const secondYear = Number.parseInt(second.year, 10);
    const firstHasYear = Number.isFinite(firstYear);
    const secondHasYear = Number.isFinite(secondYear);

    if (firstHasYear !== secondHasYear) return firstHasYear ? -1 : 1;
    if (!firstHasYear) return 0;
    return publicationSortDescending ? secondYear - firstYear : firstYear - secondYear;
  });

  targets.forEach((target) => {
    const category = target.dataset.publicationsCategory;
    const items = sortedItems.filter((item) => item.type === category);
    const label = publicationCategoryLabels[category] || "Publications";

    target.innerHTML = items.length
      ? items.map((item) => `
        <article class="academic-record">
          <div class="academic-record__meta">
            <span class="academic-record__year">${escapeHtml(item.year || "")}</span>
            ${item.status ? `<span class="academic-record__status">${escapeHtml(item.status)}</span>` : ""}
          </div>
          <div>
            <h3>${escapeHtml(item.title || "Untitled publication")}</h3>
            ${item.authors ? `<p>${escapeHtml(item.authors)}</p>` : ""}
            ${item.venue ? `<p class="academic-record__venue">${escapeHtml(item.venue)}</p>` : ""}
            ${item.type === "journal" && (item.journalQuartile || item.acceptanceRate)
              ? `<div class="academic-record__highlights">
                  ${item.journalQuartile ? `<span>${escapeHtml(item.journalQuartile)} journal</span>` : ""}
                  ${item.acceptanceRate ? `<span>${escapeHtml(item.acceptanceRate)} acceptance rate</span>` : ""}
                </div>`
              : ""}
            <div class="academic-record__links">
              ${externalLink(item.url, "Publication")}
              ${publicationPdfLink(item.pdf)}
              ${externalLink(item.doi, "DOI")}
            </div>
          </div>
        </article>
      `).join("")
      : `<p class="academic-empty-state">No ${escapeHtml(label.toLowerCase())} are listed yet.</p>`;
  });

  const sortButton = document.querySelector("[data-publication-sort]");
  if (sortButton) {
    sortButton.textContent = publicationSortDescending ? "Newest → oldest" : "Oldest → newest";
    sortButton.setAttribute(
      "aria-label",
      `Change sort order to ${publicationSortDescending ? "oldest" : "newest"} first`
    );
    sortButton.setAttribute("aria-pressed", String(!publicationSortDescending));
  }
};

document.querySelector("[data-publication-sort]")?.addEventListener("click", () => {
  publicationSortDescending = !publicationSortDescending;
  renderPublications();
});

const setupNewsCarousel = (updates) => {
  const carousel = document.querySelector("[data-news-carousel]");
  const list = carousel?.querySelector("[data-news-list]");
  const controls = carousel?.querySelector("[data-news-controls]");
  const counter = carousel?.querySelector("[data-news-count]");
  const announcement = carousel?.querySelector("[data-news-announcement]");
  const pauseButton = carousel?.querySelector("[data-news-toggle]");
  if (!carousel || !list || !controls || !counter || !announcement || !pauseButton) return;

  const items = Array.isArray(updates) ? updates : [];
  if (!items.length) {
    renderRecords("[data-news-list]", items, () => "", "No recent updates are listed yet.");
    return;
  }

  let currentIndex = 0;
  let timer = null;
  let pausedByUser = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const renderCurrent = (announce = false) => {
    const item = items[currentIndex];
    list.innerHTML = `
      <article class="academic-news-item" aria-label="News item ${currentIndex + 1} of ${items.length}">
        ${item.date ? `<time>${escapeHtml(item.date)}</time>` : ""}
        <div>
          <h3>${escapeHtml(item.title || "Academic update")}</h3>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        </div>
      </article>
    `;
    counter.textContent = `${currentIndex + 1} / ${items.length}`;
    if (announce) {
      announcement.textContent = `News item ${currentIndex + 1} of ${items.length}: ${item.title || "Academic update"}`;
    }
  };

  const stopRotation = () => {
    window.clearInterval(timer);
    timer = null;
  };

  const startRotation = () => {
    stopRotation();
    if (
      items.length < 2 ||
      pausedByUser ||
      reducedMotion.matches ||
      document.hidden ||
      carousel.contains(document.activeElement)
    ) return;

    timer = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % items.length;
      renderCurrent();
    }, 6500);
  };

  const showRelative = (offset) => {
    currentIndex = (currentIndex + offset + items.length) % items.length;
    renderCurrent(true);
    startRotation();
  };

  controls.hidden = items.length < 2;
  renderCurrent();
  if (items.length < 2) return;

  carousel.querySelector("[data-news-previous]").addEventListener("click", () => showRelative(-1));
  carousel.querySelector("[data-news-next]").addEventListener("click", () => showRelative(1));
  pauseButton.addEventListener("click", () => {
    pausedByUser = !pausedByUser;
    pauseButton.textContent = pausedByUser ? "Resume rotation" : "Pause rotation";
    pauseButton.setAttribute("aria-pressed", String(pausedByUser));
    if (pausedByUser) stopRotation();
    else startRotation();
  });
  carousel.addEventListener("focusin", stopRotation);
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) startRotation();
  });
  document.addEventListener("visibilitychange", startRotation);
  reducedMotion.addEventListener("change", startRotation);
  startRotation();
};

const setupAchievementGalleryAutoScroll = () => {
  const galleries = document.querySelectorAll(".achievement-gallery__grid");
  if (!galleries.length) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  galleries.forEach((gallery) => {
    const cards = [...gallery.querySelectorAll(".achievement-gallery__item")];
    const section = gallery.closest(".achievement-gallery__section");
    const toggle = section?.querySelector("[data-gallery-toggle]");
    const position = section?.querySelector("[data-gallery-position]");
    if (cards.length < 2 || !toggle || !position) return;

    let timer = null;
    let resumeTimer = null;
    let pausedByUser = false;
    let pointerInside = false;
    let activityPaused = false;
    let direction = 1;
    let currentIndex = 0;

    const stop = () => {
      window.clearTimeout(timer);
      timer = null;
    };

    const updatePosition = () => {
      const start = gallery.getBoundingClientRect().left + gallery.clientLeft;
      currentIndex = cards.reduce((closest, card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().left - start);
        const closestDistance = Math.abs(cards[closest].getBoundingClientRect().left - start);
        return distance < closestDistance ? index : closest;
      }, 0);
      position.textContent = `Photo ${currentIndex + 1} of ${cards.length}`;
    };

    const canScroll = () =>
      !pausedByUser &&
      !reducedMotion.matches &&
      !document.hidden &&
      !pointerInside &&
      !activityPaused &&
      !gallery.contains(document.activeElement) &&
      !document.querySelector("[data-achievement-modal]:not([hidden])");

    const schedule = () => {
      stop();
      if (!canScroll()) return;

      timer = window.setTimeout(() => {
        if (!canScroll()) return;

        let nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= cards.length) {
          direction *= -1;
          nextIndex = currentIndex + direction;
        }

        const galleryLeft = gallery.getBoundingClientRect().left + gallery.clientLeft;
        const targetLeft = Math.max(
          0,
          gallery.scrollLeft + cards[nextIndex].getBoundingClientRect().left - galleryLeft
        );
        gallery.scrollTo({ left: targetLeft, behavior: "smooth" });
        timer = window.setTimeout(() => {
          updatePosition();
          schedule();
        }, 800);
      }, 1800);
    };

    toggle.addEventListener("click", () => {
      pausedByUser = !pausedByUser;
      toggle.textContent = pausedByUser ? "Resume auto-scroll" : "Pause auto-scroll";
      toggle.setAttribute(
        "aria-label",
        pausedByUser ? "Resume automatic photo scrolling" : "Pause automatic photo scrolling"
      );
      if (pausedByUser) stop();
      else schedule();
    });

    gallery.addEventListener("scroll", updatePosition, { passive: true });
    gallery.addEventListener("pointerenter", () => {
      pointerInside = true;
      stop();
    });
    gallery.addEventListener("pointerleave", () => {
      pointerInside = false;
      schedule();
    });
    gallery.addEventListener("focusin", stop);
    gallery.addEventListener("focusout", (event) => {
      if (!gallery.contains(event.relatedTarget)) schedule();
    });

    const pauseForInteraction = () => {
      stop();
      window.clearTimeout(resumeTimer);
      if (pausedByUser) return;
      activityPaused = true;
      resumeTimer = window.setTimeout(() => {
        activityPaused = false;
        schedule();
      }, 9000);
    };

    gallery.addEventListener("pointerdown", pauseForInteraction, { passive: true });
    gallery.addEventListener("wheel", pauseForInteraction, { passive: true });
    gallery.addEventListener("keydown", pauseForInteraction);
    document.addEventListener("visibilitychange", schedule);

    const handleMotionChange = () => {
      toggle.disabled = reducedMotion.matches;
      toggle.textContent = reducedMotion.matches
        ? "Auto-scroll off"
        : pausedByUser
          ? "Resume auto-scroll"
          : "Pause auto-scroll";
      if (reducedMotion.matches) {
        toggle.setAttribute("aria-label", "Automatic photo scrolling is disabled by your reduced motion setting");
      } else if (pausedByUser) {
        toggle.setAttribute("aria-label", "Resume automatic photo scrolling");
      } else {
        toggle.setAttribute("aria-label", "Pause automatic photo scrolling");
      }
      schedule();
    };

    reducedMotion.addEventListener("change", handleMotionChange);
    handleMotionChange();

    updatePosition();
  });
};

const externalLink = (url, label) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return "";
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
};

const publicationPdfLink = (url) => {
  if (typeof url !== "string") return "";
  if (/^https?:\/\//i.test(url)) return externalLink(url, "PDF");
  if (!/^assets\/[a-zA-Z0-9._/-]+\.pdf$/i.test(url) || url.split("/").includes("..")) return "";
  return `<a href="${escapeHtml(url)}" download>Download PDF</a>`;
};

const setProfile = (profile) => {
  const profileFields = {
    name: "name",
    shortTitle: "title",
    title: "title",
    institution: "institution",
    department: "department",
    summary: "summary",
    researchAreas: "researchAreas",
    aboutHeading: "aboutHeading",
    contactText: "contactText"
  };

  document.querySelectorAll("[data-profile]").forEach((element) => {
    const value = profile[profileFields[element.dataset.profile]];

    if (value) {
      element.textContent = value;
    }
  });

  document.querySelectorAll("[data-profile-link='email'], [data-contact-link='email']").forEach((link) => {
    link.href = `mailto:${profile.email}`;
    if (link.matches("[data-contact-link]")) link.querySelector("strong").textContent = profile.email;
  });

  const institutionLink = document.querySelector("[data-contact-link='department']");
  if (institutionLink && profile.links?.department) {
    institutionLink.href = profile.links.department;
  }

  const linkedInLink = document.querySelector("[data-contact-link='linkedin']");
  if (linkedInLink && profile.links?.linkedin) {
    linkedInLink.href = profile.links.linkedin;
  }

  document.querySelectorAll("[data-profile-photo]").forEach((image) => {
    if (profile.photo) {
      image.src = profile.photo;
      if (image.alt) {
        image.alt = `Portrait of ${profile.name}`;
      }
    }
  });

  const pageHeroImage = document.body.dataset.pageHeroImage || profile.photo;
  if (pageHeroImage) {
    document.documentElement.style.setProperty(
      "--page-hero-image",
      `url(${JSON.stringify(pageHeroImage)})`
    );
  }

  document.title = `${profile.name} | ${document.body.dataset.pageTitle || "Academic Profile"}`;
};

const loadAcademicProfile = async () => {
  const endpoints = [
    "profile",
    "research",
    "education",
    "updates",
    "publications",
    "projects",
    "teaching",
    "skills",
    "achievements"
  ];
  const responses = await Promise.all(endpoints.map((endpoint) => fetch(`data/${endpoint}.json`)));
  const failedResponse = responses.find((response) => !response.ok);

  if (failedResponse) {
    throw new Error(`Academic profile request failed: ${failedResponse.url} (${failedResponse.status}).`);
  }

  const [profile, research, education, updates, publications, projects, teaching, skills, achievements] = await Promise.all(
    responses.map((response) => response.json())
  );
  setProfile(profile);

  const researchVisuals = [
    `<path class="research-illustration__chip-side" d="M108 108h104l-8 10h-88z"/><rect class="research-illustration__chip" x="108" y="39" width="104" height="72" rx="12"/><path class="research-illustration__trace" d="M126 25v14m22-14v14m24-14v14m22-14v14m-68 72v14m22-14v14m24-14v14m22-14v14M94 55h14m-14 20h14m-14 20h14m104-40h14m-14 20h14m-14 20h14"/><path class="research-illustration__detail" d="M135 62h50m-50 13h34m-34 13h42"/>`,
    `<path class="research-illustration__link" d="m86 76 48-31 50 31 50-31M86 76l48 32 50-32 50 32"/><circle class="research-illustration__node" cx="86" cy="76" r="13"/><circle class="research-illustration__node research-illustration__node--accent" cx="134" cy="45" r="13"/><circle class="research-illustration__node" cx="134" cy="108" r="13"/><circle class="research-illustration__node research-illustration__node--accent" cx="184" cy="76" r="15"/><circle class="research-illustration__node" cx="234" cy="45" r="13"/><circle class="research-illustration__node" cx="234" cy="108" r="13"/>`,
    `<path class="research-illustration__link" d="m91 95 43-51 49 34 47-37m-139 54 48 20 44-37 47 35M134 44l-2 73m51-39v3m45-40v75"/><circle class="research-illustration__node" cx="91" cy="95" r="11"/><circle class="research-illustration__node research-illustration__node--accent" cx="134" cy="44" r="12"/><circle class="research-illustration__node" cx="132" cy="117" r="11"/><circle class="research-illustration__node research-illustration__node--accent" cx="183" cy="78" r="14"/><circle class="research-illustration__node" cx="230" cy="41" r="11"/><circle class="research-illustration__node" cx="230" cy="116" r="11"/>`,
    `<rect class="research-illustration__device" x="63" y="49" width="80" height="62" rx="10"/><rect class="research-illustration__device research-illustration__device--accent" x="177" y="49" width="80" height="62" rx="10"/><path class="research-illustration__trace" d="M143 80h34m-97-45v14m19-14v14m19-14v14m95-14v14m19-14v14m19-14v14"/><path class="research-illustration__detail" d="M80 79h46m-46 13h34m80-13h46m-46 13h34"/><circle class="research-illustration__node research-illustration__node--accent" cx="160" cy="80" r="8"/>`,
    `<rect class="research-illustration__device" x="55" y="55" width="66" height="42" rx="8"/><rect class="research-illustration__device research-illustration__device--accent" x="199" y="55" width="66" height="42" rx="8"/><path class="research-illustration__link" d="M121 76h78M88 98v22h144V98"/><path class="research-illustration__task" d="M144 63h13v13h-13zm19 13h13v13h-13zm-19 19h13v13h-13zm19 13h13v13h-13zm19-33h13v13h-13zm0 20h13v13h-13z"/>`,
    `<path class="research-illustration__chart-grid" d="M58 39h204M58 75h204M58 111h204M92 24v104M160 24v104M228 24v104"/><path class="research-illustration__wave" d="M58 78h28l9-5 8 10 9-17 10 29 10-53 11 79 11-95 11 87 10-61 10 34 10-15 10 10 10-3h39"/>`,
    `<rect class="research-illustration__battery" x="96" y="44" width="126" height="68" rx="12"/><path class="research-illustration__battery-tip" d="M222 65h12v26h-12"/><path class="research-illustration__battery-level" d="M112 60h31v36h-31zm39 0h31v36h-31z"/><path class="research-illustration__bolt" d="m166 66-12 15h11l-5 12 16-18h-11z"/>`,
    `<path class="research-illustration__chart-grid" d="M62 36h198M62 70h198M62 104h198M92 25v100M142 25v100M192 25v100M242 25v100"/><path class="research-illustration__chart-axis" d="M62 125V25m0 100h198"/><path class="research-illustration__bar" d="M91 125V89h22v36zm47 0V70h22v55zm47 0V51h22v74zm47 0V36h22v89z"/>`
  ];

  renderList(
    "[data-about-list]",
    profile.about,
    (paragraph) => `<p>${escapeHtml(paragraph)}</p>`
  );
  setupNewsCarousel(updates);
  renderList(
    "[data-research-list]",
    research,
    (item, index) => {
      const visualId = `research-visual-${index}`;
      const accentStops = index % 4 === 1
        ? ["#e6fbf7", "#72d6bd", "#078778"]
        : index % 4 === 2
          ? ["#fff0e8", "#ffac81", "#c54c3b"]
          : index % 4 === 3
            ? ["#fff7dd", "#f3cf75", "#b8791f"]
            : ["#f3edff", "#b5a3ff", "#5842bf"];

      return `
      <article class="academic-card research-interest-card">
        <div
          class="research-interest-card__visual"
          aria-hidden="true"
          style="--research-wash: ${accentStops[0]}; --research-accent: ${accentStops[2]}"
        >
          <svg
            viewBox="0 0 320 170"
            focusable="false"
            style="--research-surface: url(#${visualId}-surface); --research-highlight: url(#${visualId}-highlight); --research-side: url(#${visualId}-side); --research-glow: url(#${visualId}-glow)"
          >
            <defs>
              <linearGradient id="${visualId}-surface" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="${accentStops[0]}" />
                <stop offset="0.55" stop-color="${accentStops[1]}" />
                <stop offset="1" stop-color="${accentStops[2]}" />
              </linearGradient>
              <linearGradient id="${visualId}-side" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="${accentStops[2]}" />
                <stop offset="1" stop-color="#263b69" />
              </linearGradient>
              <linearGradient id="${visualId}-highlight" x1="0" y1="0" x2="0.9" y2="1">
                <stop offset="0" stop-color="#ffffff" />
                <stop offset="1" stop-color="${accentStops[0]}" />
              </linearGradient>
              <radialGradient id="${visualId}-glow">
                <stop offset="0" stop-color="${accentStops[1]}" stop-opacity="0.38" />
                <stop offset="1" stop-color="${accentStops[1]}" stop-opacity="0" />
              </radialGradient>
              <filter id="${visualId}-shadow" x="-30%" y="-30%" width="160%" height="180%">
                <feDropShadow dx="0" dy="7" stdDeviation="5" flood-color="#263b69" flood-opacity="0.2" />
              </filter>
            </defs>
            <ellipse class="research-illustration__ground" cx="160" cy="145" rx="96" ry="10" />
            <circle class="research-illustration__glow" cx="160" cy="80" r="82" />
            <g class="research-illustration__art" filter="url(#${visualId}-shadow)">
              ${researchVisuals[index % researchVisuals.length]}
            </g>
            <path class="research-illustration__shine" d="M28 24h52" />
          </svg>
        </div>
        <div class="research-interest-card__copy">
          <span>${String(index + 1).padStart(2, "0")} / RESEARCH AREA</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
        </div>
      </article>
    `;
    }
  );
  renderList(
    "[data-education-list]",
    education,
    (item) => `
      <article class="education-entry">
        <div class="education-entry__identity">
          ${item.institutionLogo ? `<img src="${escapeHtml(item.institutionLogo)}" alt="" loading="lazy" decoding="async" />` : ""}
          <span class="education-entry__period">${escapeHtml(item.period || "")}</span>
        </div>
        <div class="education-entry__institution">
          <div class="education-entry__copy">
            <h3>${escapeHtml(item.degree)}</h3>
            ${item.institution ? `<p class="education-entry__name">${escapeHtml(item.institution)}</p>` : ""}
            ${item.details ? `<p>${escapeHtml(item.details)}</p>` : ""}
          </div>
        </div>
      </article>
    `
  );

  publicationItems = Array.isArray(publications) ? publications : [];
  renderPublications();

  renderRecords(
    "[data-projects-list]",
    projects,
    (item) => `
      <article class="academic-record academic-record--project">
        <div>
          ${item.stack ? `<p class="academic-record__venue">${escapeHtml(item.stack)}</p>` : ""}
          <h3>${escapeHtml(item.title || "Untitled project")}</h3>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
          <div class="academic-record__links">${externalLink(item.url, "Project details")}</div>
        </div>
      </article>
    `,
    "No projects are listed yet."
  );

  renderRecords(
    "[data-teaching-list]",
    teaching,
    (item) => `
      <article class="academic-record">
        <span class="academic-record__year">${escapeHtml(item.year || "")}</span>
        <div>
          <h3>${escapeHtml(item.title || "Teaching or mentoring")}</h3>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        </div>
      </article>
    `,
    "No teaching or mentoring experience is listed yet."
  );

  renderList(
    "[data-skills-list]",
    skills,
    (item) => `
      <article>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.description)}</p>
      </article>
    `
  );

  renderAchievements(achievements);
  setupAchievementGalleryAutoScroll();
};

const renderAchievements = (achievements) => {
  const gallery = document.querySelector("[data-achievements-list]");
  if (!gallery || !Array.isArray(achievements)) return;

  if (!achievements.length) {
    gallery.innerHTML = `
      <p class="academic-empty-state">
        No achievements are listed yet. Add entries to <code>backend/data/achievements.json</code>
        and put their photos in <code>frontend/assets/</code>.
      </p>
    `;
    return;
  }

  const groupedAchievements = new Map();
  achievements.forEach((item, index) => {
    const category = item.category || "Other Moments";
    if (!groupedAchievements.has(category)) groupedAchievements.set(category, []);
    groupedAchievements.get(category).push({ item, index });
  });
  const preferredCategories = ["Achievements", "Fun & Memories", "Travel & Outdoors"];
  const categories = [
    ...preferredCategories.filter((category) => groupedAchievements.has(category)),
    ...[...groupedAchievements.keys()].filter((category) => !preferredCategories.includes(category))
  ];

  gallery.innerHTML = categories
    .map((category) => {
      const headingId = `achievement-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const cards = groupedAchievements.get(category)
        .map(({ item, index }) => {
          const achievement = JSON.stringify(item)
            .replaceAll("&", "\\u0026")
            .replaceAll("<", "\\u003c")
            .replaceAll(">", "\\u003e");
          return `
            <article class="achievement-gallery__item">
              <button class="achievement-gallery__button" type="button" data-achievement-index="${index}" data-achievement="${escapeHtml(achievement)}">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.alt || item.title)}" loading="lazy" />
                <span class="achievement-gallery__caption">
                  ${item.date ? `<span class="achievement-gallery__date">${escapeHtml(item.date)}</span>` : ""}
                  <strong>${escapeHtml(item.title || "Achievement")}</strong>
                  ${item.issuer ? `<span>${escapeHtml(item.issuer)}</span>` : ""}
                  ${item.description ? `<span>${escapeHtml(item.description)}</span>` : ""}
                </span>
              </button>
            </article>
          `;
        })
        .join("");

      return `
        <section class="achievement-gallery__section" aria-labelledby="${headingId}">
          <h2 id="${headingId}">${escapeHtml(category)}</h2>
          <div class="achievement-gallery__toolbar">
            <p class="achievement-gallery__hint">Scroll sideways to browse all photos <span aria-hidden="true">→</span></p>
            <div class="achievement-gallery__controls">
              <span data-gallery-position aria-live="off"></span>
              <button class="achievement-gallery__toggle" type="button" data-gallery-toggle aria-label="Pause automatic photo scrolling">Pause auto-scroll</button>
            </div>
          </div>
          <div class="achievement-gallery__grid" tabindex="0" role="region" aria-label="${escapeHtml(category)} photos; scroll horizontally to browse">${cards}</div>
        </section>
      `;
    })
    .join("");

  gallery.querySelectorAll(".achievement-gallery__button img").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
    }, { once: true });
  });
};

loadAcademicProfile().catch((error) => {
  console.error("Could not load the academic profile data.", error);
});
