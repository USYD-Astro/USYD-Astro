/* Photo submission.
 *
 * The chosen photos are POSTed to the upload relay. Pages cannot accept an
 * upload and no credential can live in this page, so a small Worker holds the
 * GitHub token and commits the submission for us. See relay/README.md. The
 * endpoint is configured on the form element.
 *
 * Nothing is re-encoded on the way out: the file a visitor picked or dropped
 * is the file that gets sent, metadata and all. So it is the publishing
 * Action, not this page, that removes EXIF and GPS -- it re-encodes each photo
 * when it derives the web-sized copies the site serves, and those copies are
 * the only ones that are ever published.
 *
 * What is checked here is therefore only what would waste a submitter's time
 * or jam the queue: the eight-photo cap, the relay's 12 MB ceiling, and the
 * formats the publishing toolchain can actually read.
 *
 * This also owns the dialog the form lives in. Closing it deliberately keeps
 * the form's contents, so the upload dialog can be dismissed and reopened
 * without losing a half-finished submission.
 */
(function () {
  "use strict";

  var form = document.getElementById("photo-form");
  if (!form) {
    return;
  }

  var RELAY = form.dataset.relay || "";

  var MAX_FILES = 8;
  /* The relay refuses anything larger, so catching it here saves a visitor on
     a phone the wait of uploading a photo that was always going to bounce. */
  var MAX_BYTES = 12 * 1048576;
  /* What tools/gallery.py can open. HEIC and HEIF are deliberately absent:
     Pillow cannot read them without a decoder the publishing Action does not
     install, and one unreadable photo stops the whole publishing run rather
     than just that photo. */
  var PUBLISHABLE = ["image/jpeg", "image/png", "image/webp"];

  /* Read fields by id rather than form.<name>: HTMLFormElement has its own
     `name` property, so form.name is the form's name attribute rather than
     the input called "name". */
  var input = document.getElementById("photos");
  var dropzone = document.getElementById("dropzone");
  var previews = document.getElementById("previews");
  var statusLine = document.getElementById("status");
  var submitBtn = document.getElementById("send");

  var prepared = [];

  /* ---- the upload dialog ------------------------------------------------ */

  var dialog = document.getElementById("upload-modal");
  var opener = document.getElementById("open-upload");
  var closer = document.getElementById("close-upload");

  if (dialog && opener) {
    opener.addEventListener("click", function () {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        /* No <dialog> support: show it in place rather than not at all. */
        dialog.setAttribute("open", "");
      }
      document.body.style.overflow = "hidden";
      /* Focus the file field rather than the close button, which is what the
         browser would otherwise pick as the first focusable thing. */
      if (input) {
        input.focus();
      }
    });

    function closeDialog() {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
        document.body.style.overflow = "";
      }
    }

    if (closer) {
      closer.addEventListener("click", closeDialog);
    }

    /* Anything clicked that targets the dialog itself came from the backdrop:
       the panel fills the dialog edge to edge, so the form is never the
       target of a click that would close it. */
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        closeDialog();
      }
    });

    /* Fires for every way out, including Escape, which the browser handles
       itself. Closing the dialog keeps whatever was filled in, so a visitor
       who dismisses it by accident does not lose their photos. */
    dialog.addEventListener("close", function () {
      document.body.style.overflow = "";
    });
  }

  function human(bytes) {
    return bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + " MB"
      : Math.max(1, Math.round(bytes / 1024)) + " kB";
  }

  function say(message, kind) {
    statusLine.textContent = message || "";
    statusLine.className = "form-status" + (kind ? " form-status--" + kind : "");
  }

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  /* ---- prepare each photo on selection --------------------------------- */

  function publishable(file) {
    if (PUBLISHABLE.indexOf((file.type || "").toLowerCase()) !== -1) {
      return true;
    }
    /* A drop does not always carry a type, so fall back to the name. */
    return /\.(jpe?g|png|webp)$/i.test(file.name || "");
  }

  function readyMessage() {
    var count = prepared.length;
    if (!count) {
      return "";
    }
    return count + " photo" + (count === 1 ? "" : "s") + " ready to send.";
  }

  /* Rebuilding the list is also how a photo leaves it, so the object URLs from
     the previous pass are released here. Without that, every removal would
     keep its photo in memory until the page was closed. */
  function releaseThumbs() {
    Array.prototype.slice.call(previews.querySelectorAll("img")).forEach(function (img) {
      if (img.src.indexOf("blob:") === 0) {
        URL.revokeObjectURL(img.src);
      }
    });
  }

  function render() {
    releaseThumbs();
    previews.innerHTML = "";
    prepared.forEach(function (entry, index) {
      var item = document.createElement("li");

      /* The selected file itself can be shown directly, which is why this no
         longer needs a re-encoded copy to put in the list. */
      var thumb = document.createElement("img");
      thumb.src = URL.createObjectURL(entry.file);
      thumb.alt = "";
      item.appendChild(thumb);

      var meta = document.createElement("span");
      meta.className = "previews__meta";
      meta.textContent = entry.name + " \u2014 " + human(entry.size);
      item.appendChild(meta);

      /* Wrong photo picked, or the wrong one dragged in: this is the way
         back out of the list. */
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "previews__remove";
      remove.setAttribute("data-index", index);
      remove.setAttribute("aria-label", "Remove " + entry.name);
      remove.textContent = "\u2715";
      item.appendChild(remove);

      previews.appendChild(item);
    });
  }

  previews.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest(".previews__remove");
    if (!button) {
      return;
    }
    prepared.splice(Number(button.getAttribute("data-index")), 1);
    render();
    say(readyMessage());
  });

  /* Both the picker and a drop end up here, so a dropped photo is checked the
     same way a chosen one is. Whatever is turned away is named rather than
     counted, because a dropped folder can hide all sorts of things. */
  function accept(files) {
    prepared = [];

    if (!files.length) {
      render();
      say("");
      return;
    }
    if (files.length > MAX_FILES) {
      render();
      say(
        "Please choose at most " + MAX_FILES + " photos at a time \u2014 you sent " +
          files.length + ". Send them in a couple of batches.",
        "warn"
      );
      input.value = "";
      return;
    }

    var skipped = [];
    files.forEach(function (file) {
      if (!publishable(file)) {
        skipped.push(file.name + " is not a JPEG, PNG or WebP");
      } else if (file.size > MAX_BYTES) {
        skipped.push(file.name + " is larger than 12 MB");
      } else {
        prepared.push({ file: file, name: file.name, size: file.size });
      }
    });

    render();

    if (!prepared.length) {
      say("None of those files can be published. " + skipped.join("; ") + ".", "warn");
    } else if (skipped.length) {
      say(readyMessage() + " Skipped " + skipped.join("; ") + ".", "warn");
    } else {
      say(readyMessage(), "ok");
    }
  }

  input.addEventListener("change", function () {
    accept(Array.prototype.slice.call(input.files || []));
    /* Emptied once the files have been taken, so that choosing the same photo
       again still counts as a change -- without this, removing a photo and
       then re-picking it silently does nothing. */
    input.value = "";
  });

  /* ---- dropping photos onto the page ------------------------------------ */

  function carriesFiles(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, "Files") !== -1;
  }

  if (dropzone) {
    dropzone.addEventListener("dragenter", function (event) {
      if (!carriesFiles(event)) {
        return;
      }
      event.preventDefault();
      dropzone.classList.add("is-over");
    });

    dropzone.addEventListener("dragover", function (event) {
      if (!carriesFiles(event)) {
        return;
      }
      /* Without this the drop never fires at all: the browser's default is to
         navigate to the dragged file. */
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });

    dropzone.addEventListener("dragleave", function (event) {
      /* Moving onto one of the children counts as leaving the label, and the
         children take no pointer events, so this is only a real exit. */
      if (dropzone.contains(event.relatedTarget)) {
        return;
      }
      dropzone.classList.remove("is-over");
    });

    dropzone.addEventListener("drop", function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-over");
      var dropped = event.dataTransfer && event.dataTransfer.files;
      if (dropped && dropped.length) {
        accept(Array.prototype.slice.call(dropped));
      }
    });

    /* A photo dropped a few pixels wide of the target would otherwise replace
       the page with the image, taking the half-filled form with it. */
    ["dragover", "drop"].forEach(function (name) {
      window.addEventListener(name, function (event) {
        if (carriesFiles(event)) {
          event.preventDefault();
        }
      });
    });
  }

  /* ---- upload ----------------------------------------------------------- */

  function buildForm() {
    var body = new FormData();
    /* No credit field: the name the submitter gives is what their photos are
       published under. tools/publish_submissions.py already falls back to the
       name when the credit is empty, so nothing downstream needs changing. */
    body.append(
      "meta",
      JSON.stringify({
        name: value("name"),
        email: value("email"),
        caption: value("caption"),
        consent: document.getElementById("consent").checked
      })
    );
    prepared.forEach(function (entry) {
      body.append("photos", entry.file, entry.name);
    });
    return body;
  }

  function fail(message) {
    say(message, "warn");
    submitBtn.disabled = false;
    submitBtn.textContent = "Send my photos";
  }

  function succeed(message) {
    say(message, "ok");
    form.reset();
    prepared = [];
    render();
    submitBtn.disabled = false;
    submitBtn.textContent = "Send my photos";
  }

  function upload(body) {
    var request = new XMLHttpRequest();
    request.open("POST", RELAY);
    request.responseType = "json";

    request.upload.addEventListener("progress", function (event) {
      if (!event.lengthComputable) {
        return;
      }
      var percent = Math.round((event.loaded / event.total) * 100);
      submitBtn.textContent = "Sending\u2026 " + percent + "%";
      say("Uploading your photos\u2026 " + percent + "%");
    });

    request.addEventListener("load", function () {
      var response = request.response;
      if (request.status >= 200 && request.status < 300 && response && response.ok) {
        succeed(response.message || "Thanks \u2014 your photos are with us.");
        return;
      }
      fail(
        (response && response.error) ||
          "Something went wrong on our side (server said " + request.status + "). Please try again."
      );
    });

    request.addEventListener("error", function () {
      fail("We could not reach the upload service. Check your connection and try again.");
    });

    request.addEventListener("timeout", function () {
      fail("The upload timed out. Please try again, perhaps with fewer photos at once.");
    });

    request.send(body);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!RELAY) {
      fail("Uploads are not switched on yet. Please try again later.");
      return;
    }
    if (!prepared.length) {
      say("Choose at least one photo first.", "warn");
      input.focus();
      return;
    }
    if (!value("name")) {
      say("Please give a name \u2014 it is how your photos are credited.", "warn");
      document.getElementById("name").focus();
      return;
    }
    if (!value("email") || value("email").indexOf("@") < 1) {
      say("We need an email address so we can reply.", "warn");
      document.getElementById("email").focus();
      return;
    }
    if (!document.getElementById("consent").checked) {
      say("Please confirm the consent box before sending.", "warn");
      document.getElementById("consent").focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending\u2026";
    say("Uploading your photos\u2026");
    upload(buildForm());
  });

  /* Show the visitor why the button does nothing, rather than letting them
     fill the whole form in first. */
  if (!RELAY) {
    say("Uploads are not switched on yet.", "warn");
  }
})();
