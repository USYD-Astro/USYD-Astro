/* Small progressive-enhancement script: mobile nav toggle, the photo
   lightbox and the submitted-photo rail. Without JS the site is still fully
   readable, and the rail is still scrollable and swipeable. */
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

  /* ---- photo lightbox ---------------------------------------------------- */
  /* One lightbox serves both galleries: the grid on the home page and the
     rail on the submit page. Thumbnails are selected by their gallery rather
     than by a data attribute, because the rail's photographs carry the
     submission's details and those have to travel with the image. */
  var thumbs = Array.prototype.slice.call(
    document.querySelectorAll(".gallery img, .rail img")
  );
  if (!thumbs.length) {
    return;
  }

  var lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Photo");
  lightbox.innerHTML =
    '<div class="lightbox__bar">' +
    '<button type="button" data-act="prev" aria-label="Previous photo">&#8249;</button>' +
    '<button type="button" data-act="next" aria-label="Next photo">&#8250;</button>' +
    '<button type="button" data-act="close" aria-label="Close">&#10005;</button>' +
    "</div>" +
    '<img alt="">' +
    '<div class="lightbox__meta"></div>';
  document.body.appendChild(lightbox);

  var pic = lightbox.querySelector("img");
  var meta = lightbox.querySelector(".lightbox__meta");
  var index = 0;

  /* Whatever a submitter wrote is inserted as text, never as markup: a
     caption is somebody else's sentence on a page anyone can reach. */
  function detail(text, className) {
    var line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    return line;
  }

  function readableDate(value) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!parts) {
      return value || "";
    }
    /* Built from the parts rather than parsed: "2026-09-16" parses as UTC
       midnight, which is the previous day west of Greenwich. */
    var when = new Date(+parts[1], +parts[2] - 1, +parts[3]);
    return when.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  function show(i) {
    index = (i + thumbs.length) % thumbs.length;
    var thumb = thumbs[index];
    var data = thumb.dataset;

    pic.src = data.full || thumb.src;
    pic.alt = thumb.alt || "";

    meta.innerHTML = "";
    if (data.credit) {
      meta.appendChild(detail(data.credit, "lightbox__credit"));
    }
    if (data.caption) {
      meta.appendChild(detail(data.caption, "lightbox__caption"));
    }
    if (data.date) {
      meta.appendChild(detail("Sent in " + readableDate(data.date), "lightbox__date"));
    }
    lightbox.classList.toggle("has-meta", meta.childNodes.length > 0);

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

/* ---- submitted photo rail ------------------------------------------------- */
/* The rail on the submit page shows four photos at a time and pages sideways.
   It is an ordinary horizontally scrolling element, so a touch screen swipes
   it and the arrow keys scroll it when it has focus; the arrows here add a
   way to page it with a mouse, and hide themselves when there is nothing to
   page. */
(function () {
  "use strict";

  var rail = document.getElementById("rail");
  var nav = document.getElementById("rail-nav");
  var prev = document.getElementById("rail-prev");
  var next = document.getElementById("rail-next");

  if (!rail || !nav || !prev || !next) {
    return;
  }

  /* One page is exactly one rail width, which is four photos plus the gaps
     between them, and scroll snapping tidies up whatever is left over. */
  function page(direction) {
    rail.scrollBy({ left: direction * rail.clientWidth, behavior: "smooth" });
  }

  function sync() {
    var overflowing = rail.scrollWidth > rail.clientWidth + 1;
    nav.hidden = !overflowing;
    if (!overflowing) {
      return;
    }
    /* A pixel of slack, because sub-pixel scroll positions never land
       exactly on the ends. */
    prev.disabled = rail.scrollLeft <= 1;
    next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
  }

  prev.addEventListener("click", function () {
    page(-1);
  });
  next.addEventListener("click", function () {
    page(1);
  });
  rail.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
  sync();
})();
