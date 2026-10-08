/* The club's own events as a month grid, on the home page.
 *
 * The events are not fetched here: includes/events.php has already read them,
 * from the cache the canoe club publish, and the page hands them over as JSON
 * in a <script> block. This file only draws them.
 *
 * The grid is FullCalendar, the same library and the same month view the canoe
 * club's outdoors calendar uses -- same toolbar, same Monday-first week, same
 * "6pm: Stargazing" tile -- wearing this site's colours instead of theirs. What
 * is deliberately not copied is everything on that page that only concerns
 * them: SUBW and SUSS trips, the SUCC database, the meteor-shower overlay and
 * the club badge in the corner of each tile.
 *
 * Without JavaScript the page still lists the events under the same heading
 * (see the <noscript> in index.php), and if the library itself fails to load
 * this falls back to writing that same list into the grid's place. */
(function () {
  "use strict";

  var container = document.getElementById("suas-calendar");
  var payload = document.getElementById("suas-calendar-data");
  if (!container || !payload) {
    return;
  }

  var events;
  try {
    events = JSON.parse(payload.textContent);
  } catch (error) {
    events = [];
  }
  if (!events.length) {
    return;
  }

  /* "2026-08-27" as the club reads it, built from its parts rather than handed
     to the Date constructor: that parses a bare date string as UTC midnight,
     which is the previous day anywhere west of Greenwich. */
  function formatDate(value) {
    var parts = String(value).split("-");
    if (parts.length !== 3) {
      return value;
    }
    var day = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return day.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  /* The grid needs the library and nothing else does, so a blocked or failed
     CDN leaves an empty month rather than no calendar. The list is written here
     instead, built the same way the <noscript> one is. */
  function renderListFallback() {
    var list = document.createElement("ul");
    list.className = "calendar__list";
    events.forEach(function (event) {
      var item = document.createElement("li");
      var when = document.createElement("strong");
      when.textContent = formatDate(event.date) + (event.timeLabel ? ", " + event.timeLabel : "");
      item.appendChild(when);
      item.appendChild(document.createTextNode(" \u2014 " + event.title));
      /* Most of the upstream titles already end in "at <venue>", so the place
         is only added when the title does not already say it. */
      if (event.place && event.title.indexOf(event.place) === -1) {
        item.appendChild(document.createTextNode(" at " + event.place));
      }
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  if (typeof window.FullCalendar === "undefined") {
    renderListFallback();
    return;
  }

  /* ---- the entry dialog ------------------------------------------------- */

  var dialog = document.getElementById("event-modal");
  var dialogTitle = document.getElementById("event-modal-title");
  var dialogWhen = document.getElementById("event-modal-when");
  var dialogPlace = document.getElementById("event-modal-place");
  var dialogNotes = document.getElementById("event-modal-notes");
  var dialogLink = document.getElementById("event-modal-link");
  var dialogPoster = document.getElementById("event-modal-poster");

  function closeDialog() {
    if (dialog && typeof dialog.close === "function") {
      dialog.close();
    }
  }

  function openEvent(event) {
    if (!dialog || !dialogTitle) {
      return;
    }

    dialogTitle.textContent = event.title;

    dialogWhen.textContent = formatDate(event.date) + (event.timeLabel ? ", " + event.timeLabel : "");

    setField(dialogPlace, event.place);
    setField(dialogNotes, event.notes);

    if (dialogLink) {
      if (event.link) {
        dialogLink.href = event.link;
        dialogLink.hidden = false;
      } else {
        dialogLink.hidden = true;
      }
    }

    if (dialogPoster) {
      if (event.image) {
        dialogPoster.src = event.image;
        dialogPoster.hidden = false;
      } else {
        dialogPoster.hidden = true;
        dialogPoster.removeAttribute("src");
      }
    }

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      /* No <dialog> support: show it in place rather than not at all. */
      dialog.setAttribute("open", "");
      document.body.style.overflow = "hidden";
    }
  }

  /* A field the event does not have is hidden rather than left as an empty
     paragraph taking up its spacing. */
  function setField(element, value) {
    if (!element) {
      return;
    }
    if (value) {
      element.textContent = value;
      element.hidden = false;
    } else {
      element.textContent = "";
      element.hidden = true;
    }
  }

  if (dialog) {
    var closer = document.getElementById("event-modal-close");
    if (closer) {
      closer.addEventListener("click", closeDialog);
    }

    /* Anything clicked that targets the dialog itself came from the backdrop:
       the panel fills the dialog edge to edge, so its contents are never the
       target of a click that would close it. */
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        closeDialog();
      }
    });

    /* Fires for every way out, including Escape, which the browser handles
       itself. */
    dialog.addEventListener("close", function () {
      document.body.style.overflow = "";
    });

    /* A poster that does not load leaves a broken frame, so it is hidden
       instead; the tile it belongs to is still there to pick. */
    if (dialogPoster) {
      dialogPoster.addEventListener("error", function () {
        dialogPoster.hidden = true;
      });
    }
  }

  /* ---- the month grid --------------------------------------------------- */

  function toCalendarEvent(event) {
    return {
      /* The time rides in the title rather than in FullCalendar's own time
         slot, exactly as the canoe club's calendar does it, so that every
         entry is one whole-day tile instead of a strip with a clock on it. */
      title: event.timeLabel ? event.timeLabel + ": " + event.title : event.title,
      start: event.date,
      allDay: true,
      className: event.past ? "calendar__event calendar__event--past" : "calendar__event",
      extendedProps: { event: event }
    };
  }

  var calendar = new window.FullCalendar.Calendar(container, {
    headerToolbar: {
      left: "prev,next",
      center: "title",
      right: "today"
    },
    height: "auto",
    initialView: "dayGridMonth",
    /* The canoe club's 2.5 is a wide, shallow month -- a month band rather than
       a grid -- and it only works because their calendar gets the full width
       of the page. A phone gives it a third of that, where 2.5 would squash
       six weeks into a strip, so the ratio is picked once for the viewport the
       visitor arrived with. */
    aspectRatio: window.matchMedia("(max-width: 700px)").matches ? 1 : 2.5,
    initialDate: new Date(),
    firstDay: 1,
    eventOrder: "title",
    events: events.map(toCalendarEvent),
    eventClick: function (info) {
      openEvent(info.event.extendedProps.event);
    }
  });

  calendar.render();
})();
