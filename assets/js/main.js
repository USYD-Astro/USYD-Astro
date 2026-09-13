/* Small progressive-enhancement script: mobile nav toggle and the
   event-gallery lightbox. Without JS the site is still fully readable. */
(function () {
  "use strict";

  /* ---- mobile navigation ------------------------------------------------ */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---- hero slideshow ---------------------------------------------------- */
  /* The band at the top of the home page crossfades through the gallery
     photos. The first slide is server-rendered as is-current, so the band
     is never empty; this only takes over the stepping. Pausing when the
     tab is hidden keeps the show from banking up a backlog of ticks while
     invisible, and prefers-reduced-motion keeps the first slide still. */
  var slidesRoot = document.getElementById("hero-slides");
  if (slidesRoot) {
    var slides = Array.prototype.slice.call(slidesRoot.querySelectorAll(".hero__slide"));
    var shown = Math.max(0, slides.findIndex(function (el) {
      return el.classList.contains("is-current");
    }));
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var paused = document.hidden;
    var timer = 0;

    var showSlide = function (i) {
      shown = (i + slides.length) % slides.length;
      slides.forEach(function (el, n) {
        el.classList.toggle("is-current", n === shown);
      });
    };

    var step = function () {
      showSlide(shown + 1);
    };

    var stop = function () {
      window.clearInterval(timer);
      timer = 0;
    };

    var start = function () {
      if (timer || paused || reduceMotion || slides.length < 2) {
        return;
      }
      timer = window.setInterval(step, 5200);
    };

    start();

    document.addEventListener("visibilitychange", function () {
      paused = document.hidden;
      if (paused) {
        stop();
      } else {
        start();
      }
    });
  }

  /* ---- event gallery lightbox ------------------------------------------- */
  var gallery = document.querySelector(".gallery");
  if (!gallery) {
    return;
  }

  var lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Event photo");
  lightbox.innerHTML =
    '<div class="lightbox__bar">' +
    '<button type="button" data-act="prev" aria-label="Previous photo">&#8249;</button>' +
    '<button type="button" data-act="next" aria-label="Next photo">&#8250;</button>' +
    '<button type="button" data-act="close" aria-label="Close">&#10005;</button>' +
    "</div>" +
    '<img alt="">';
  document.body.appendChild(lightbox);

  var pic = lightbox.querySelector("img");
  var thumbs = Array.prototype.slice.call(gallery.querySelectorAll("img"));
  var index = 0;

  function show(i) {
    index = (i + thumbs.length) % thumbs.length;
    pic.src = thumbs[index].dataset.full || thumbs[index].src;
    pic.alt = thumbs[index].alt || "";
    lightbox.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function hide() {
    lightbox.classList.remove("is-open");
    document.body.style.overflow = "";
    pic.src = "";
  }

  thumbs.forEach(function (img, i) {
    img.parentElement.addEventListener("click", function () {
      show(i);
    });
  });

  lightbox.addEventListener("click", function (e) {
    var act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (act === "close" || e.target === lightbox) {
      hide();
    } else if (act === "next") {
      show(index + 1);
    } else if (act === "prev") {
      show(index - 1);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("is-open")) {
      return;
    }
    if (e.key === "Escape") {
      hide();
    } else if (e.key === "ArrowRight") {
      show(index + 1);
    } else if (e.key === "ArrowLeft") {
      show(index - 1);
    }
  });
})();
