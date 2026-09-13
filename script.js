(function () {
  "use strict";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initThemeToggle() {
    const toggle = document.querySelector(".theme-toggle");
    const icon = toggle && toggle.querySelector("i");
    if (!toggle || !icon) return;
    function setTheme(theme) {
      const dark = theme === "dark";
      document.body.classList.toggle("dark-theme", dark);
      toggle.setAttribute("aria-pressed", String(dark));
      toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      icon.className = dark ? "fas fa-sun" : "fas fa-moon";
      localStorage.setItem("portfolio-theme", theme);
    }
    setTheme(localStorage.getItem("portfolio-theme") === "dark" ? "dark" : "light");
    toggle.addEventListener("click", () => setTheme(document.body.classList.contains("dark-theme") ? "light" : "dark"));
  }

  function initMenu() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".nav-links");
    if (!toggle || !nav) return;
    const close = () => { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "Open navigation"); };
    toggle.addEventListener("click", () => { const open = nav.classList.toggle("is-open"); toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation"); });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
  }

  function initTyping() {
    const target = document.getElementById("typed-text");
    if (!target) return;
    if (reducedMotion) { target.textContent = "modern web applications."; return; }
    const words = ["modern web applications.", "responsive websites.", "interactive user interfaces."];
    let word = 0, letter = 0, deleting = false;
    function type() {
      const text = words[word]; target.textContent = text.slice(0, letter);
      if (!deleting && letter < text.length) { letter++; setTimeout(type, 70); }
      else if (!deleting) { deleting = true; setTimeout(type, 1300); }
      else if (letter > 0) { letter--; setTimeout(type, 38); }
      else { deleting = false; word = (word + 1) % words.length; setTimeout(type, 260); }
    } type();
  }

  function initRevealAndNavigation() {
    const reveals = document.querySelectorAll(".reveal");
    if (reducedMotion) reveals.forEach((item) => item.classList.add("visible"));
    else { const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); } }), { threshold: 0.12 }); reveals.forEach((item) => observer.observe(item)); }
    const links = document.querySelectorAll(".nav-links a");
    const sections = document.querySelectorAll("main section[id]");
    const navObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`)); }), { rootMargin: "-35% 0px -55% 0px" });
    sections.forEach((section) => navObserver.observe(section));
  }

  function initContactForm() {
    const form = document.querySelector(".contact-form"); const status = document.querySelector(".form-status");
    if (!form || !status) return;
    form.addEventListener("submit", (event) => { event.preventDefault(); if (!form.checkValidity()) { status.textContent = "Please complete your name, email, and message."; form.reportValidity(); return; } status.textContent = "Thanks — your message is ready to send. Connect this form to a backend or email service to deliver it."; form.reset(); });
  }

  document.addEventListener("DOMContentLoaded", () => { document.getElementById("year").textContent = new Date().getFullYear(); initThemeToggle(); initMenu(); initTyping(); initRevealAndNavigation(); initContactForm(); });
}());
