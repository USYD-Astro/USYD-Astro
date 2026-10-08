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
  var status = null;
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
      '<div class="lightbox__meta"></div>' +
      '<p class="form-status lightbox__status" role="status"></p>';
    document.body.appendChild(lightbox);

    pic = lightbox.querySelector("img");
    meta = lightbox.querySelector(".lightbox__meta");
    status = lightbox.querySelector(".lightbox__status");

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

  /* ---- deleting a photo -------------------------------------------------- */
  /* The delete control in the photo viewer. An ordinary button: pressing it
     opens the password prompt, and the password is what gates the deletion, so
     the button has nothing of its own to hide behind.

     The password is checked on the server, by moderate.php, against the hash in
     ~/suas-config.php. It is not in this file and never reaches the page as a
     value: it goes up the wire once, over HTTPS, and is checked there. Anyone
     who knows it can delete, and anyone who does not cannot -- one shared
     password rather than an account each, which is the arrangement this site
     wants. */
  var MODERATE = (function () {
    /* On <body> of every page: the remove control appears in the lightbox
       wherever a photo is opened, and the upload form that carried this
       endpoint before is not on all of them. */
    var host = document.querySelector("[data-moderate-endpoint]");
    return host ? host.dataset.moderateEndpoint : "";
  })();

  /* The prompt is built on first use, like the lightbox: most visits never
     open it. */
  var prompt = null;
  var promptLead = null;
  var promptPassword = null;
  var promptReason = null;
  var promptStatus = null;
  var promptConfirm = null;
  var pendingThumb = null;

  /* What the viewer says when it is still on screen to say it. */
  function setLightboxStatus(message, ok) {
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.className =
      "form-status lightbox__status" +
      (ok ? " form-status--ok" : " form-status--warn");
  }

  /* What the prompt says while it is open. Nothing succeeds in place here -- a
     deletion closes it -- so this is only ever breaking bad news. */
  function setPromptStatus(message) {
    promptStatus.textContent = message || "";
    promptStatus.className = "form-status form-status--warn";
  }

  function buildPrompt() {
    prompt = document.createElement("dialog");
    prompt.className = "modal modal--prompt";
    prompt.setAttribute("aria-labelledby", "delete-title");
    prompt.innerHTML =
      '<div class="modal__panel">' +
      '<div class="modal__head">' +
      '<h2 id="delete-title">Delete this photo?</h2>' +
      '<button type="button" class="modal__close" data-act="cancel" aria-label="Close">&#10005;</button>' +
      "</div>" +
      '<div class="modal__body">' +
      '<p class="hint" data-part="lead"></p>' +
      '<div class="field">' +
      '<label for="delete-password">Password</label>' +
      '<input type="password" id="delete-password" autocomplete="off" required>' +
      "</div>" +
      '<div class="field">' +
      '<label for="delete-reason">Reason (optional)</label>' +
      '<input type="text" id="delete-reason" maxlength="200">' +
      "</div>" +
      '<p class="form-status" data-part="status" role="status"></p>' +
      "</div>" +
      '<div class="modal__foot">' +
      '<div class="form-actions">' +
      '<button type="button" class="button button--danger button--lg" data-act="delete">Delete photo</button>' +
      '<button type="button" class="button button--ghost button--lg" data-act="cancel">Cancel</button>' +
      "</div>" +
      "</div>" +
      "</div>";
    document.body.appendChild(prompt);

    promptLead = prompt.querySelector('[data-part="lead"]');
    promptPassword = prompt.querySelector("#delete-password");
    promptReason = prompt.querySelector("#delete-reason");
    promptStatus = prompt.querySelector('[data-part="status"]');
    promptConfirm = prompt.querySelector('[data-act="delete"]');

    prompt.addEventListener("click", function (e) {
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "cancel") {
        prompt.close();
      } else if (act === "delete") {
        sendDeletion();
      }
    });

    /* Enter in a field deletes, the way a form would. Only in a field: the
       buttons answer Enter themselves, and intercepting it here would turn
       Enter on Cancel into a deletion. */
    prompt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        sendDeletion();
      }
    });

    prompt.addEventListener("close", function () {
      pendingThumb = null;
      setPromptStatus("");
    });
  }

  function openPrompt(thumb) {
    if (!prompt) {
      buildPrompt();
    }
    var name = filenameFor(thumb);
    if (!name) {
      return;
    }
    pendingThumb = thumb;
    promptLead.textContent =
      name + " comes off the site now, along with its thumbnails. This cannot be undone.";
    promptPassword.value = "";
    promptReason.value = "";
    setPromptStatus("");
    promptConfirm.disabled = false;
    promptConfirm.textContent = "Delete photo";
    /* Native <dialog>: the backdrop, Escape and the focus trap are the
       browser's, and the top layer puts it above the viewer behind it. */
    prompt.showModal();
    promptPassword.focus();
  }

  function sendDeletion() {
    if (promptConfirm.disabled) {
      return;
    }
    var name = filenameFor(pendingThumb);
    if (!name) {
      return;
    }
    if (!promptPassword.value) {
      setPromptStatus("Enter the gallery password.");
      promptPassword.focus();
      return;
    }
    if (!MODERATE) {
      setPromptStatus("Deleting is not configured on this site.");
      return;
    }

    promptConfirm.disabled = true;
    promptConfirm.textContent = "Deleting…";
    setPromptStatus("");

    fetch(MODERATE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* The password travels with the request and nowhere else: moderate.php
         holds the hash and is the only thing that can check it, which is why
         this is a file on our own server rather than something the page can
         talk to without a credential. */
      body: JSON.stringify({
        filename: name,
        reason: promptReason.value,
        password: promptPassword.value,
      }),
    })
      .then(function (response) {
        return response.json().then(
          function (data) {
            return { ok: response.ok, data: data };
          },
          function () {
            /* A non-JSON answer is a proxy or server error page, not a verdict
               from moderate.php. */
            return { ok: false, data: null };
          }
        );
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.ok) {
          afterDeletion(pendingThumb, result.data.message);
          return;
        }
        setPromptStatus(
          (result.data && result.data.error) || "That photo was not deleted."
        );
        promptConfirm.disabled = false;
        promptConfirm.textContent = "Delete photo";
      })
      .catch(function () {
        setPromptStatus("We could not reach the server. Is the site online?");
        promptConfirm.disabled = false;
        promptConfirm.textContent = "Delete photo";
      });
  }

  /* The photo is off the site by the time this runs, so the page is brought
     into line with that: the tile goes, and the viewer moves on to whichever
     photo took its place. */
  function afterDeletion(thumb, message) {
    var at = thumbs.indexOf(thumb);
    if (at !== -1) {
      thumbs.splice(at, 1);
    }
    var tile = thumb.parentElement;
    if (tile && tile.parentNode) {
      tile.parentNode.removeChild(tile);
    }
    prompt.close();

    if (!thumbs.length) {
      /* Nothing left to look at, so there is no viewer to report in. The home
         page's rail carries a status line of its own. */
      hide();
      announce(message);
      return;
    }
    show(at === -1 || at >= thumbs.length ? 0 : at);
    setLightboxStatus(message, true);
  }

  /* For the one case the viewer cannot report in itself: the last photo on the
     page having just gone. */
  function announce(message) {
    var note = document.getElementById("rail-note");
    if (!note) {
      window.alert(message);
      return;
    }
    note.textContent = message;
    note.hidden = false;
  }

  /* The button itself. Only a published photo offers one: a tile the submitter
     is still looking at has no stored copy to take down. */
  function removeControl(thumb) {
    var wrap = document.createElement("p");
    wrap.className = "lightbox__delete-wrap";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "lightbox__delete";
    button.textContent = "Delete photo";
    button.addEventListener("click", function () {
      openPrompt(thumb);
    });

    wrap.appendChild(button);
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
    setLightboxStatus("");
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
    /* The prompt is a dialog of its own: while it is open, Escape belongs to it
       rather than to the viewer behind it, and the arrow keys belong to
       whatever is being typed into it. */
    if (prompt && prompt.open) {
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
