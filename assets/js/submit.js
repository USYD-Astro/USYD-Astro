/* Photo submission.

   The site is static, so there is nowhere to POST a photo to. This script
   therefore does the two things a browser can usefully do on its own:

     1. shrink each photo and drop its metadata, and
     2. hand the prepared files to the visitor's own email app.

   Step 1 matters more than it looks. Re-encoding through a canvas writes a
   brand new JPEG and carries no EXIF across, so the GPS coordinates that
   phones attach to every photo never leave the device. There is no library
   here doing that -- it falls out of the re-encode.

   Files are prepared when they are *selected*, not when the form is
   submitted, because navigator.share() must be called while the click that
   triggered it is still the current user gesture. Awaiting a resize inside
   the submit handler would lose that gesture and the share sheet would never
   open.
*/
(function () {
  "use strict";

  var form = document.getElementById("photo-form");
  if (!form) {
    return;
  }

  /* Read fields via getElementById rather than form.<name>: HTMLFormElement
     has its own `name` property, so form.name returns the form's name
     attribute rather than the input called "name". */
  var input = document.getElementById("photos");
  var previews = document.getElementById("previews");
  var statusLine = document.getElementById("status");
  var downloadBtn = document.getElementById("download");

  var EMAIL = "usydastronomy@gmail.com";
  var LONG_EDGE = 1600;
  var QUALITY = 0.82;

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

  function shrink(file) {
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
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

  function asFile(entry) {
    return new File([entry.blob], entry.name, { type: "image/jpeg" });
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

      if (entry.width) {
        var dims = document.createElement("span");
        dims.className = "previews__dims";
        dims.textContent = entry.width + "\u00d7" + entry.height;
        item.appendChild(dims);
      }

      previews.appendChild(item);
    });
  }

  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    prepared = [];
    previews.innerHTML = "";
    downloadBtn.hidden = true;

    if (!files.length) {
      say("");
      return;
    }

    /* No createImageBitmap: send the originals and be honest about it. */
    if (typeof createImageBitmap !== "function") {
      prepared = files.map(function (file) {
        return {
          name: file.name,
          blob: file,
          original: file.size,
          reduced: file.size,
          width: 0,
          height: 0
        };
      });
      render();
      say(
        "This browser can\u2019t shrink photos before sending, so the originals " +
          "will be used and they may still contain location data. If that " +
          "matters to you, use the email option at the bottom of the page instead.",
        "warn"
      );
      return;
    }

    say("Preparing " + files.length + " photo" + (files.length === 1 ? "" : "s") + "\u2026");

    var jobs = files.map(function (file) {
      return shrink(file)
        .then(function (result) {
          return {
            name: (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg",
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

  function message() {
    var credit = document.getElementById("credit").value.trim();
    var caption = document.getElementById("caption").value.trim();
    var lines = [
      "Name: " + document.getElementById("name").value.trim(),
      "Email: " + document.getElementById("email").value.trim(),
      "Credit as: " + (credit || "(no preference)"),
      "",
      "Photos: " + prepared.length,
      ""
    ];
    if (caption) {
      lines.push("Notes:");
      lines.push(caption);
      lines.push("");
    }
    lines.push(
      "I confirm I took these photos or have permission to share them, and " +
        "that anyone pictured is happy for them to appear on the SUAS website."
    );
    return lines.join("\n");
  }

  function openMail() {
    var subject = "Photo submission for the SUAS gallery";
    window.location.href =
      "mailto:" + EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(message());
    downloadBtn.hidden = false;
    say(
      "Your email app should have opened with the details filled in. " +
        "Attach the prepared photos, or use the download button, then send.",
      "ok"
    );
  }

  downloadBtn.addEventListener("click", function () {
    prepared.forEach(function (entry, index) {
      window.setTimeout(function () {
        var url = URL.createObjectURL(entry.blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = entry.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
      }, index * 250);
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    /* Honeypot: only a bot fills a field it cannot see. */
    if (document.getElementById("website").value) {
      say("Thanks \u2014 your photos are on their way.", "ok");
      return;
    }

    var name = document.getElementById("name").value.trim();
    var email = document.getElementById("email").value.trim();
    var consent = document.getElementById("consent").checked;

    if (!prepared.length) {
      say("Choose at least one photo first.", "warn");
      input.focus();
      return;
    }
    if (!name) {
      say("We need a name to credit the photos to.", "warn");
      document.getElementById("name").focus();
      return;
    }
    if (!email || email.indexOf("@") < 1) {
      say("We need an email address so we can reply.", "warn");
      document.getElementById("email").focus();
      return;
    }
    if (!consent) {
      say("Please confirm the consent box before sending.", "warn");
      document.getElementById("consent").focus();
      return;
    }

    var files = prepared.map(asFile);

    /* Best case: the OS share sheet opens with the photos already attached,
       and the visitor picks Mail. This is the normal path on a phone. */
    if (navigator.canShare) {
      var shareable = false;
      try {
        shareable = navigator.canShare({ files: files });
      } catch (error) {
        shareable = false;
      }
      if (shareable) {
        navigator
          .share({
            files: files,
            title: "Photos for the SUAS gallery",
            text: message()
          })
          .then(function () {
            say("Thanks \u2014 send that and we\u2019ll add them to the gallery.", "ok");
          })
          .catch(function (error) {
            /* AbortError means they closed the sheet on purpose. */
            if (error && error.name === "AbortError") {
              return;
            }
            openMail();
          });
        return;
      }
    }

    openMail();
  });
})();
