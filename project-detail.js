(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const homeView = document.getElementById("home-view");
  const projectView = document.getElementById("project-view");
  const baseTitle = document.title;

  if (!homeView || !projectView || typeof window.PROJECTS === "undefined") return;

  const FALLBACK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">' +
        '<rect width="1200" height="750" fill="#231b2e"/>' +
        '<rect x="28" y="28" width="1144" height="694" rx="26" fill="none" stroke="#40334e" stroke-width="3" stroke-dasharray="14 14"/>' +
        '<text x="600" y="365" text-anchor="middle" fill="#b88aff" font-family="Inter,Arial,sans-serif" font-size="40" font-weight="700">Screenshot coming soon</text>' +
        '<text x="600" y="415" text-anchor="middle" fill="#c7bdcf" font-family="Inter,Arial,sans-serif" font-size="22">Add this image to the project images folder</text>' +
        "</svg>"
    );

  let galleryProject = null;
  let shotIndex = 0;
  let openedFromPortfolio = false;
  let lastFocused = null;
  let backToProjectsRequested = false;

  function getProject(id) {
    if (!id) return null;
    const key = String(id).trim().toLowerCase();
    return (
      window.PROJECTS.find(function (project) {
        if (project.id === key) return true;
        return Array.isArray(project.aliases) && project.aliases.indexOf(key) !== -1;
      }) || null
    );
  }

  function shotAlt(project, src, index, total) {
    if (src === FALLBACK) return project.title + " — screenshot coming soon";
    const caption = project.captions && project.captions[index];
    if (caption) return project.title + " — " + caption + " (screenshot " + (index + 1) + " of " + total + ")";
    const file = src.split("/").pop().replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    return project.title + " screenshot " + (index + 1) + " of " + total + " — " + file;
  }

  function isCaseStudy(project) {
    return Boolean(project.overview || project.designUx || project.keySections || project.projectInfo);
  }

  function attachFallback(img) {
    img.addEventListener("error", function onErr() {
      if (img.dataset.fallback === "1") return;
      img.dataset.fallback = "1";
      img.src = FALLBACK;
    });
  }

  function actionButton(url, label, icon, variant) {
    const cls = "btn " + (variant === "primary" ? "btn-primary" : "btn-secondary");
    if (url) {
      return (
        '<a class="' + cls + '" href="' + url + '" target="_blank" rel="noopener noreferrer">' +
        label + ' <i class="fas ' + icon + '"></i></a>'
      );
    }
    return (
      '<span class="' + cls + ' btn-disabled" role="link" aria-disabled="true" ' +
      'title="Add this link in projects-data.js">' + label + ' <i class="fas ' + icon + '"></i></span>'
    );
  }

  function renderDetail(project) {
    const shots = Array.isArray(project.screenshots) ? project.screenshots.slice() : [];
    if (shots.length === 0) shots.push(FALLBACK);
    const total = shots.length;
    const caseStudy = isCaseStudy(project);
    const tech = project.technologies.map((t) => "<span>" + t + "</span>").join("");
    const features = project.features.map((f) => "<li>" + f + "</li>").join("");
    const thumbCols = total > 0 && total < 5 ? ' style="grid-template-columns:repeat(' + total + ',minmax(0,1fr))"' : "";
    const thumbs = shots
      .map(function (src, i) {
        const alt = shotAlt(project, src, i, total);
        const caption = project.captions && project.captions[i] ? ' title="' + project.captions[i] + '"' : "";
        return (
          '<button class="gallery-thumb' + (i === 0 ? " is-active" : "") +
          '" type="button" data-index="' + i + '" aria-pressed="' + (i === 0) +
          '" aria-label="View screenshot ' + (i + 1) + " of " + total + ": " + alt + '"' + caption + ">" +
          '<img src="' + src + '" alt="' + alt + '" loading="lazy">' +
          "</button>"
        );
      })
      .join("");
    const galleryCaption = project.captions
      ? '<p class="gallery-caption" data-gallery-caption aria-live="polite">' + project.captions[0] + "</p>"
      : "";

    let sections;
    if (caseStudy) {
      const keySections = (project.keySections || [])
        .map(function (s) { return "<li>" + s + "</li>"; })
        .join("");
      const meta = (project.projectInfo || [])
        .map(function (item) {
          return "<div><dt>" + item.label + "</dt><dd>" + item.value + "</dd></div>";
        })
        .join("");
      sections =
        '<section class="project-info-grid">' +
          '<article class="info-card"><h3>Project Overview</h3><p>' + (project.overview || "") + "</p></article>" +
          '<article class="info-card"><h3>About the Project</h3><p>' + project.longDescription + "</p></article>" +
        "</section>" +
        '<section class="detail-section" aria-labelledby="features-heading">' +
          '<div class="detail-heading"><p class="section-kicker">Capabilities</p><h2 id="features-heading">Key Features</h2></div>' +
          '<ul class="feature-grid">' + features + "</ul>" +
        "</section>" +
        (keySections
          ? '<section class="detail-section" aria-labelledby="sections-heading">' +
              '<div class="detail-heading"><p class="section-kicker">Structure</p><h2 id="sections-heading">Key Sections</h2></div>' +
              '<ul class="section-chips">' + keySections + "</ul>" +
            "</section>"
          : "") +
        (project.designUx
          ? '<section class="detail-section" aria-labelledby="design-heading">' +
              '<div class="detail-heading"><p class="section-kicker">Interface</p><h2 id="design-heading">Design &amp; User Experience</h2></div>' +
              '<article class="info-card"><p>' + project.designUx + "</p></article>" +
            "</section>"
          : "") +
        '<section class="detail-section" aria-labelledby="tech-heading">' +
          '<div class="detail-heading"><p class="section-kicker">Stack</p><h2 id="tech-heading">Technologies Used</h2></div>' +
          '<div class="project-tags project-badges">' + tech + "</div>" +
        "</section>" +
        (meta
          ? '<section class="detail-section" aria-labelledby="info-heading">' +
              '<div class="detail-heading"><p class="section-kicker">Details</p><h2 id="info-heading">Project Information</h2></div>' +
              '<dl class="project-meta">' + meta + "</dl>" +
            "</section>"
          : "") +
        '<section class="detail-section" aria-labelledby="links-heading">' +
          '<div class="detail-heading"><p class="section-kicker">Connect</p><h2 id="links-heading">Project Links</h2></div>' +
          '<div class="project-actions">' +
            actionButton(project.liveDemo, "Live Demo", "fa-arrow-up-right-from-square", "primary") +
            actionButton(project.github, "GitHub", "fa-code-branch", "secondary") +
          "</div>" +
        "</section>";
    } else {
      sections =
        '<section class="project-info-grid">' +
          '<article class="info-card"><h3>About this project</h3><p>' + project.longDescription + "</p></article>" +
          '<article class="info-card"><h3>Features</h3><ul class="feature-list">' + features + "</ul></article>" +
        "</section>";
    }

    projectView.innerHTML =
      '<div class="container project-detail">' +
        '<button class="btn btn-secondary back-btn" type="button"><i class="fas fa-arrow-left"></i> Back to Projects</button>' +
        '<header class="project-hero">' +
          '<p class="section-kicker">' + project.category + "</p>" +
          "<h1>" + project.title + "</h1>" +
          '<p class="project-hero-desc">' + project.description + "</p>" +
          '<div class="project-tags project-badges">' + tech + "</div>" +
          '<div class="project-actions">' +
            actionButton(project.liveDemo, "Live Demo", "fa-arrow-up-right-from-square", "primary") +
            actionButton(project.github, "GitHub", "fa-code-branch", "secondary") +
          "</div>" +
        "</header>" +
        '<section class="detail-section" aria-labelledby="gallery-heading">' +
          '<div class="detail-heading"><p class="section-kicker">Gallery</p><h2 id="gallery-heading">Screenshot Gallery</h2></div>' +
          '<div class="gallery" tabindex="0" role="region" aria-label="Project screenshot gallery">' +
            '<div class="gallery-main" data-gallery-main>' +
              '<img src="' + shots[0] + '" alt="' + shotAlt(project, shots[0], 0, total) + '">' +
              '<button class="gallery-nav gallery-prev" type="button" aria-label="Previous screenshot"><i class="fas fa-chevron-left"></i></button>' +
              '<button class="gallery-nav gallery-next" type="button" aria-label="Next screenshot"><i class="fas fa-chevron-right"></i></button>' +
              '<button class="gallery-zoom" type="button" aria-label="Open screenshot in fullscreen"><i class="fas fa-expand"></i></button>' +
              '<span class="gallery-counter" aria-live="polite">1 / ' + total + "</span>" +
            "</div>" +
            '<div class="gallery-thumbs"' + thumbCols + ">" + thumbs + "</div>" +
            galleryCaption +
          "</div>" +
        "</section>" +
        sections +
        '<div class="project-detail-footer">' +
          '<button class="btn btn-secondary back-btn-bottom" type="button"><i class="fas fa-arrow-left"></i> Back to Projects</button>' +
        "</div>" +
      "</div>" +
      '<div class="lightbox" hidden role="dialog" aria-modal="true" aria-label="' + project.title + ' screenshot viewer">' +
        '<div class="lightbox-stage">' +
          '<button class="lightbox-close" type="button" aria-label="Close fullscreen gallery"><i class="fas fa-xmark"></i></button>' +
          '<img src="' + shots[0] + '" alt="' + shotAlt(project, shots[0], 0, total) + '">' +
          '<button class="gallery-nav lightbox-prev" type="button" aria-label="Previous screenshot"><i class="fas fa-chevron-left"></i></button>' +
          '<button class="gallery-nav lightbox-next" type="button" aria-label="Next screenshot"><i class="fas fa-chevron-right"></i></button>' +
          '<span class="gallery-counter lightbox-counter" aria-live="polite">1 / ' + total + "</span>" +
        "</div>" +
      "</div>";

    galleryProject = project;
    shotIndex = 0;

    projectView.querySelectorAll("img").forEach(attachFallback);

    const mainImg = projectView.querySelector("[data-gallery-main] img");
    mainImg.dataset.src = shots[0];

    projectView.querySelector(".back-btn").addEventListener("click", goBackToProjects);
    projectView.querySelector(".back-btn-bottom").addEventListener("click", goBackToProjects);

    projectView.querySelector(".gallery-prev").addEventListener("click", function () { step(-1); });
    projectView.querySelector(".gallery-next").addEventListener("click", function () { step(1); });
    projectView.querySelector(".gallery-main").addEventListener("click", function (event) {
      if (event.target.closest("button")) return;
      openLightbox();
    });
    projectView.querySelector(".gallery-zoom").addEventListener("click", openLightbox);

    projectView.querySelectorAll(".gallery-thumb").forEach(function (thumb) {
      thumb.addEventListener("click", function () {
        setShot(Number(thumb.dataset.index));
      });
    });

    const captionEl = projectView.querySelector("[data-gallery-caption]");
    if (captionEl) captionEl.dataset.ready = "1";

    const lightbox = getLightbox();
    lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    lightbox.querySelector(".lightbox-prev").addEventListener("click", function () { step(-1); });
    lightbox.querySelector(".lightbox-next").addEventListener("click", function () { step(1); });
    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) closeLightbox();
    });
  }

  function getLightbox() {
    return projectView.querySelector(".lightbox");
  }

  function updateGalleryUI() {
    if (!galleryProject) return;
    const total = galleryProject.screenshots.length;
    const label = shotIndex + 1 + " / " + total;
    const counter = projectView.querySelector(".gallery-counter:not(.lightbox-counter)");
    if (counter) counter.textContent = label;
    const lightbox = getLightbox();
    const lbCounter = lightbox && lightbox.querySelector(".lightbox-counter");
    if (lbCounter) lbCounter.textContent = label;

    projectView.querySelectorAll(".gallery-thumb").forEach(function (thumb) {
      const active = Number(thumb.dataset.index) === shotIndex;
      thumb.classList.toggle("is-active", active);
      thumb.setAttribute("aria-pressed", String(active));
    });

    const captionEl = projectView.querySelector("[data-gallery-caption]");
    if (captionEl && galleryProject.captions) {
      captionEl.textContent = galleryProject.captions[shotIndex] || "";
    }
  }

  function applyImage(container, src, alt) {
    const img = container.querySelector("img");
    if (!img) return;
    img.dataset.fallback = "";
    img.src = src;
    img.alt = alt;
  }

  function setShot(index, instant) {
    if (!galleryProject) return;
    const shots = galleryProject.screenshots;
    const total = shots.length;
    shotIndex = ((index % total) + total) % total;
    const src = shots[shotIndex];
    const alt = shotAlt(galleryProject, src, shotIndex, total);

    const main = projectView.querySelector("[data-gallery-main]");
    const mainImg = main.querySelector("img");
    const swapMain = function () {
      applyImage(main, src, alt);
      mainImg.dataset.src = src;
      mainImg.classList.remove("is-swapping");
    };
    if (instant || reducedMotion || mainImg.dataset.src === src) {
      swapMain();
    } else {
      mainImg.classList.add("is-swapping");
      setTimeout(swapMain, 180);
    }

    const lightbox = getLightbox();
    if (lightbox && !lightbox.hidden) {
      applyImage(lightbox.querySelector(".lightbox-stage"), src, alt);
    }
    updateGalleryUI();
  }

  function step(delta) {
    if (!galleryProject) return;
    setShot(shotIndex + delta);
  }

  function openLightbox() {
    if (!galleryProject) return;
    const lightbox = getLightbox();
    lastFocused = document.activeElement;
    setShot(shotIndex, true);
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    lightbox.querySelector(".lightbox-close").focus();
  }

  function closeLightbox() {
    const lightbox = getLightbox();
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.style.overflow = "";
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function scrollToProjects() {
    const target = document.getElementById("projects");
    if (!target) return;
    requestAnimationFrame(function () {
      target.scrollIntoView();
    });
  }

  function goBackToProjects() {
    backToProjectsRequested = true;
    if (openedFromPortfolio && window.history.length > 1) {
      window.history.back();
      window.setTimeout(function () {
        if (!backToProjectsRequested) return;
        backToProjectsRequested = false;
        window.location.hash = "#projects";
      }, 500);
    } else {
      backToProjectsRequested = false;
      window.location.hash = "#projects";
    }
  }

  function showProject(project) {
    closeLightbox();
    renderDetail(project);
    homeView.hidden = true;
    projectView.hidden = false;
    document.body.classList.add("project-open");
    document.title = project.title + " | Umair Khan";
    document.querySelectorAll(".nav-links a").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("href") === "#projects");
    });
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } catch (err) {
      window.scrollTo(0, 0);
    }
    const back = projectView.querySelector(".back-btn");
    if (back) back.focus({ preventScroll: true });
  }

  function showHome(hash) {
    closeLightbox();
    projectView.hidden = true;
    projectView.innerHTML = "";
    galleryProject = null;
    homeView.hidden = false;
    document.body.classList.remove("project-open");
    document.title = baseTitle;
    if (backToProjectsRequested) {
      backToProjectsRequested = false;
      scrollToProjects();
      return;
    }
    if (hash && hash.length > 1 && hash.indexOf("#/") !== 0) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        requestAnimationFrame(function () {
          target.scrollIntoView();
        });
      }
    }
  }

  function queryProjectId() {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("id") || params.get("project") || "";
  }

  function route() {
    const hash = window.location.hash || "";
    const match = hash.match(/^#\/project\/(.+)$/);
    if (match) {
      const project = getProject(match[1]);
      if (project) {
        showProject(project);
        return;
      }
      showHome("#projects");
      return;
    }
    if (!hash || hash === "#" || hash === "#home") {
      const projectId = queryProjectId();
      if (projectId) {
        const project = getProject(projectId);
        if (project) {
          showProject(project);
          return;
        }
      }
    }
    showHome(hash);
  }

  function openProject(id) {
    if (!getProject(id)) return;
    openedFromPortfolio = true;
    window.location.hash = "#/project/" + id;
  }

  function initCards() {
    document.querySelectorAll(".project-card[data-project-id]").forEach(function (card) {
      const id = card.getAttribute("data-project-id");
      card.addEventListener("click", function () { openProject(id); });
      card.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          openProject(id);
        }
      });
    });
  }

  function initKeyboard() {
    document.addEventListener("keydown", function (event) {
      if (projectView.hidden) return;
      const lightbox = getLightbox();
      if (lightbox && !lightbox.hidden) {
        if (event.key === "Escape") { event.preventDefault(); closeLightbox(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
        return;
      }
      const gallery = projectView.querySelector(".gallery");
      if (gallery && gallery.contains(document.activeElement)) {
        if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initCards();
    initKeyboard();
    window.addEventListener("hashchange", route);
    route();
  });
}());
