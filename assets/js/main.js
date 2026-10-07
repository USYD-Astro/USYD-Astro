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

  /* ---- under-construction notice ---------------------------------------- */
  /* The notice is in the markup of every page and is visible whether or not
     this script runs. The inline script in the head turns it into a modal when
     scripting is available, and hides it again for the rest of the session if
     it has already been dismissed; all that is left to do here is the
     dismissing. It sits above the lightbox below, which has to build itself
     before it can be asked anything. */
  var construction = document.getElementById("construction");
  var constructionDismiss = document.getElementById("construction-dismiss");
  var constructionShown = function () {
    return document.documentElement.classList.contains("js")
      && !document.documentElement.classList.contains("construction-dismissed");
  };

  if (construction && constructionDismiss) {
    /* Only claim focus and the scrollbar if the notice is actually in front of
       the visitor: with it already dismissed for this session, and no modal on
       screen, locking scrolling here would strand every later page. */
    if (constructionShown()) {
      constructionDismiss.focus();
      document.body.style.overflow = "hidden";
    }

    var dismissConstruction = function () {
      document.documentElement.classList.add("construction-dismissed");
      document.body.style.overflow = "";
      try {
        sessionStorage.setItem("suas-construction-dismissed", "1");
      } catch (error) {
        /* Storage unavailable: the notice simply returns on the next page. */
      }
      constructionDismiss.blur();
    };

    constructionDismiss.addEventListener("click", dismissConstruction);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && constructionShown()) {
        dismissConstruction();
      }
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
     submission's details and those have to travel with the image.

     The list is filled by register() rather than read once, because a
     visitor's own photos are added to the rail after the page has loaded
     (see "photos sent in from this page" below) and those have to open in
     the lightbox like any other. Which is also why nothing here gives up
     early on an empty list: a site nobody has submitted to yet has no
     thumbnails at all until the first upload. */
  var thumbs = [];
  var lightbox = null;
  var pic = null;
  var meta = null;
  var index = 0;

  function register(list) {
    Array.prototype.slice.call(list).forEach(function (img) {
      thumbs.push(img);
      var i = thumbs.length - 1;
      /* The wrapper, not the image, is the click target: that is what the
         published markup already does, and a pending tile is a button too. */
      if (img.parentElement) {
        img.parentElement.addEventListener("click", function () {
          show(i);
        });
      }
    });
  }

  function build() {
    lightbox = document.createElement("div");
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

    pic = lightbox.querySelector("img");
    meta = lightbox.querySelector(".lightbox__meta");

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
  }

  document.addEventListener("suas:rail-added", function (event) {
    register((event.detail && event.detail.images) || []);
  });

  register(document.querySelectorAll(".gallery img, .rail img"));

  /* Whatever a submitter wrote is inserted as text, never as markup: a
     caption is somebody else's sentence on a page anyone can reach. */
  function detail(text, className) {
    var line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    return line;
  }

  /* ---- removing a photo ------------------------------------------------- */
  /* The button a committee member uses to take a photo out of the gallery. It
     posts to moderate.php on this site.

     The password box is now a real check. It used to be a speed bump that
     nothing verified, because this was a static page and a password read here
     would have been a string in every visitor's devtools -- so the page said so
     rather than pretend. The endpoint is on this server and holds the hash, so
     the password is sent over HTTPS and checked against it there, and the photo
     is off the site as soon as the button is pressed rather than on the next
     build.

     HIDING THE BUTTON IS STILL NOT SECURITY. It is kept quiet because it is not
     for visitors, not because anything depends on them not finding it. */
  var MODERATE = (function () {
    /* On <body> of every page: the remove control appears in the lightbox
       wherever a photo is opened, and the upload form that carried this
       endpoint before is not on all of them. */
    var host = document.querySelector("[data-moderate-endpoint]");
    return host ? host.dataset.moderateEndpoint : "";
  })();

  function removeControl(thumb) {
    var wrap = document.createElement("p");
    wrap.className = "lightbox__admin";

    var name = filenameFor(thumb);
    if (!name) {
      /* A photo added to the rail from this page has no published name yet, so
         there is nothing in the repository to remove. */
      var none = document.createElement("span");
      none.className = "lightbox__admin-note";
      none.textContent = "This photo is not published yet.";
      wrap.appendChild(none);
      return wrap;
    }

    /* Always present, so the remove button is reachable to be revealed.
       Quiet on purpose -- a way in for the committee, not something to
       advertise. */
    var reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "lightbox__admin-reveal";
    reveal.textContent = "Admin";
    reveal.setAttribute("aria-expanded", "false");

    var button = document.createElement("button");
    button.type = "button";
    button.className = "lightbox__remove";
    button.textContent = "Remove from gallery";
    button.hidden = true;

    var fields = document.createElement("span");
    fields.className = "lightbox__admin-fields";
    fields.hidden = true;

    var label = document.createElement("label");
    label.className = "lightbox__admin-label";
    label.textContent = "Password";
    var input = document.createElement("input");
    input.type = "password";
    input.className = "lightbox__admin-input";
    input.autocomplete = "off";
    /* The password this site is administered with. It is checked on the server,
       so it is the same one the admin page takes. */
    input.title = "The gallery password.";
    label.appendChild(input);
    fields.appendChild(label);

    reveal.addEventListener("click", function () {
      fields.hidden = !fields.hidden;
      reveal.setAttribute("aria-expanded", fields.hidden ? "false" : "true");
      if (!fields.hidden) {
        input.focus();
      }
    });

    button.addEventListener("click", function () {
      if (button.disabled) {
        return;
      }
      if (!input.value) {
        input.focus();
        return;
      }
      if (!MODERATE) {
        window.alert("Removal is not configured on this site.");
        return;
      }
      var reason = window.prompt(
        "Why is this photo being removed? This is recorded with the removal.",
        ""
      );
      if (reason === null) {
        return;
      }
      button.disabled = true;
      button.textContent = "…";
      fetch(MODERATE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        /* The password goes with it: moderate.php holds the hash and checks it,
           which is the whole reason this endpoint is a file on our own server
           rather than something the page can talk to without a credential. */
        body: JSON.stringify({
          filename: name,
          reason: reason,
          password: input.value,
        }),
      })
        .then(function (response) {
          return response.json().then(
            function (data) {
              return { ok: response.ok, data: data };
            },
            function () {
              /* A non-JSON answer is a proxy or server error page, not a
                 verdict from moderate.php. */
              return { ok: false, data: null };
            }
          );
        })
        .then(function (result) {
          if (result.ok && result.data && result.data.ok) {
            /* The photo is off the site already, so this is the end of the view
               rather than something to go back from. */
            hide();
            window.alert(
              (result.data && result.data.message) ||
                "That photo is on its way off the site."
            );
            return;
          }
          window.alert(
            (result.data && result.data.error) || "The removal did not work."
          );
          button.disabled = false;
          button.textContent = "Remove from gallery";
        })
        .catch(function () {
          button.disabled = false;
          button.textContent = "Remove from gallery";
          window.alert("We could not reach the server. Is the site online?");
        });
    });

    wrap.appendChild(reveal);
    wrap.appendChild(fields);
    fields.appendChild(button);
    return wrap;
  }

  /* The gallery filename a thumbnail belongs to, which is what the removal
     command needs. data-full is the path we published it at, so the name is
     the last part of it. */
  function filenameFor(thumb) {
    var full = thumb.dataset.full || "";
    var name = full.split("/").pop() || "";
    return /^\d{2,}\.[A-Za-z0-9]+$/.test(name) ? name : "";
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
    if (!lightbox) {
      build();
    }
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
    /* Both galleries can have a photo taken out of them, so this is not
       limited to the rail. */
    if (filenameFor(thumb)) {
      meta.appendChild(removeControl(thumb));
    }
    lightbox.classList.toggle("has-meta", meta.childNodes.length > 0);

    lightbox.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function hide() {
    if (!lightbox) {
      return;
    }
    lightbox.classList.remove("is-open");
    document.body.style.overflow = "";
    pic.src = "";
  }

  document.addEventListener("keydown", function (e) {
    if (!lightbox || !lightbox.classList.contains("is-open")) {
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
  /* Photos sent in from this page are added to the rail after load, which can
     take it from fitting on screen to overflowing it, so the arrows are
     re-checked when that happens and not only on the next scroll. */
  document.addEventListener("suas:rail-added", sync);
  sync();
})();

/* ---- photos sent in from this page --------------------------------------- */
/* A successful upload is announced by submit.js, and the photos it just sent
   are added to the rail here so the submitter can see them at once instead
   of waiting for the publishing Action to regenerate this page.

   These are the file that came off the submitter's own camera, shown through
   an object URL -- not the copy the site serves, which is re-encoded and
   stripped of EXIF further downstream. That is what the flag on the tile is
   for, and why nothing is kept: the next page load has the published rail,
   and until then these are the only trace of the upload, held in this tab
   alone. */
(function () {
  "use strict";

  var rail = document.getElementById("rail");
  var note = document.getElementById("rail-note");
  if (!rail) {
    return;
  }

  function tile(photo, detail) {
    var item = document.createElement("button");
    item.type = "button";
    item.className = "rail__item rail__item--pending";

    /* The details go on the image the way the server puts them on a published
       one, so the lightbox reads them from the same place. Text is set as
       text, never as markup. */
    var img = document.createElement("img");
    img.src = URL.createObjectURL(photo.file);
    img.alt = "Your photo, just added to the submitted gallery";
    if (detail.credit) {
      img.dataset.credit = detail.credit;
    }
    if (detail.caption) {
      img.dataset.caption = detail.caption;
    }
    if (detail.date) {
      img.dataset.date = detail.date;
    }
    item.appendChild(img);

    var flag = document.createElement("span");
    flag.className = "rail__flag";
    flag.textContent = "Just added";
    item.appendChild(flag);

    return { item: item, img: img };
  }

  document.addEventListener("suas:submissions-added", function (event) {
    var detail = (event && event.detail) || {};
    var photos = detail.photos || [];
    if (!photos.length) {
      return;
    }

    /* The rail holds a "nothing sent in yet" note until the first submission
       is published, which is exactly when a submitter is least likely to have
       seen it. It has no business sitting above their own photo. */
    var empty = rail.querySelector(".rail__empty");
    if (empty) {
      empty.parentNode.removeChild(empty);
    }

    /* Appended, not prepended: photo_all() lists the stored photos in order
       too, so these land where the published photos will land. */
    var images = [];
    var newest = null;
    photos.forEach(function (photo) {
      var made = tile(photo, detail);
      images.push(made.img);
      rail.appendChild(made.item);
      newest = made.item;
    });

    if (note) {
      var count = photos.length;
      note.textContent =
        count === 1
          ? "Your photo is now at the end of the gallery."
          : "Your " + count + " photos are now at the end of the gallery.";
      note.hidden = false;
    }

    document.dispatchEvent(
      new CustomEvent("suas:rail-added", { detail: { images: images } })
    );

    /* A frame later, so the upload dialog is properly gone first: the page
       is still unscrollable while it is open, and the scroll would be
       swallowed. */
    window.requestAnimationFrame(function () {
      if (!newest) {
        return;
      }
      /* The last of them, not the first: the rail is a strip that pages
         sideways, so lining the first new photo up with the right-hand edge
         would show one of eight and hide the rest behind it. */
      newest.scrollIntoView({
        block: "center",
        inline: "end",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  });
})();
