/* Photo submission.
 *
 * Two things happen here, in this order:
 *
 *   1. Each photo is re-encoded through a canvas, which caps its size and
 *      drops every EXIF tag. That is a privacy step, not a nicety: phones
 *      write GPS coordinates into every photo, and a canvas re-encode writes
 *      brand new bytes with no metadata carried across. The relay strips
 *      metadata again on the way in, so this is defence in depth rather than
 *      the only line.
 *
 *   2. The prepared photos are POSTed to the upload relay. Pages cannot
 *      accept an upload and no credential can live in this page, so a small
 *      Worker holds the GitHub token and commits the submission for us. See
 *      relay/README.md. The endpoint is configured on the form element.
 *
 * Files are prepared when they are *selected* rather than when the form is
 * submitted, so that pressing the button starts the upload immediately
 * instead of making the visitor watch a progress bar that is really a resize.
 */
(function () {
  "use strict";

  var form = document.getElementById("photo-form");
  if (!form) {
    return;
  }

  var RELAY = form.dataset.relay || "";

  var THUMB_EDGE = 1600;
  var QUALITY = 0.82;
  var MAX_FILES = 8;

  /* Read fields by id rather than form.<name>: HTMLFormElement has its own
     `name` property, so form.name is the form's name attribute rather than
     the input called "name". */
  var input = document.getElementById("photos");
  var previews = document.getElementById("previews");
  var statusLine = document.getElementById("status");
  var submitBtn = document.getElementById("send");

  var prepared = [];

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

  function shrink(file) {
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
      var width = Math.max(1, Math.round(bitmap.width * scale));
      var height = Math.max(1, Math.round(bitmap.height * scale));

      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }

      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            if (blob) {
              resolve({ blob: blob, width: width, height: height });
            } else {
              reject(new Error("could not prepare " + file.name));
            }
          },
          "image/jpeg",
          QUALITY
        );
      });
    });
  }

  function render() {
    previews.innerHTML = "";
    prepared.forEach(function (entry) {
      var item = document.createElement("li");

      var thumb = document.createElement("img");
      thumb.src = URL.createObjectURL(entry.blob);
      thumb.alt = "";
      item.appendChild(thumb);

      var meta = document.createElement("span");
      meta.className = "previews__meta";
      meta.textContent =
        entry.name + " \u2014 " + human(entry.original) +
        " \u2192 " + human(entry.reduced);
      item.appendChild(meta);

      var dims = document.createElement("span");
      dims.className = "previews__dims";
      dims.textContent = entry.width + "\u00d7" + entry.height;
      item.appendChild(dims);

      previews.appendChild(item);
    });
  }

  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    prepared = [];
    previews.innerHTML = "";

    if (!files.length) {
      say("");
      return;
    }
    if (files.length > MAX_FILES) {
      say(
        "Please choose at most " + MAX_FILES + " photos at a time \u2014 you sent " +
          files.length + ". Send them in a couple of batches.",
        "warn"
      );
      input.value = "";
      return;
    }

    /* No createImageBitmap: we cannot strip metadata here, so say so rather
       than quietly sending photos with the submitter's home address in them. */
    if (typeof createImageBitmap !== "function") {
      prepared = [];
      input.value = "";
      say(
        "This browser can\u2019t prepare photos before sending, so uploading is " +
          "unavailable here. Please try a newer browser.",
        "warn"
      );
      return;
    }

    say("Preparing " + files.length + " photo" + (files.length === 1 ? "" : "s") + "\u2026");

    var jobs = files.map(function (file, index) {
      return shrink(file)
        .then(function (result) {
          return {
            name: "photo-" + (index + 1) + ".jpg",
            blob: result.blob,
            original: file.size,
            reduced: result.blob.size,
            width: result.width,
            height: result.height
          };
        })
        .catch(function () {
          return null;
        });
    });

    Promise.all(jobs).then(function (results) {
      prepared = results.filter(Boolean);
      render();
      var failed = results.length - prepared.length;
      if (!prepared.length) {
        say("None of those files could be read as photos.", "warn");
      } else if (failed) {
        say(prepared.length + " ready, " + failed + " skipped (unreadable).", "warn");
      } else {
        say(
          prepared.length + " photo" + (prepared.length === 1 ? "" : "s") +
            " ready. Location data and other metadata have been removed.",
          "ok"
        );
      }
    });
  });

  /* ---- upload ----------------------------------------------------------- */

  function buildForm() {
    var body = new FormData();
    body.append(
      "meta",
      JSON.stringify({
        name: value("name"),
        email: value("email"),
        credit: value("credit"),
        caption: value("caption"),
        consent: document.getElementById("consent").checked
      })
    );
    prepared.forEach(function (entry) {
      body.append("photos", entry.blob, entry.name);
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
    previews.innerHTML = "";
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
      say("We need a name to credit the photos to.", "warn");
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
