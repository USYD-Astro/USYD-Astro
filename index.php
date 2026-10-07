<?php
declare(strict_types=1);

/**
 * The home page: the competition, the photos sent in so far, and the gallery.
 *
 * All three image blocks used to be generated into this file by tools/gallery.py
 * and checked in CI to keep them from drifting. They are rendered from the photo
 * directories here instead: the hero and the gallery from photos/, the rail from
 * photos/queue/.
 *
 * The upload form posts to upload.php on this same server. It used to post to a
 * Cloudflare Worker, because GitHub Pages cannot accept an upload and no
 * credential that can write to a repository belongs in a public page. PHP can
 * take the upload itself, so the Worker, its token and the branch it committed to
 * are gone; the endpoint below validates the same things and files the photos in
 * the rail, where a committee member promotes the ones that belong on the home
 * page gallery.
 */

require __DIR__ . '/includes/bootstrap.php';

$page_title = 'SUAS | Sydney University Astronomy Society';
$page_og_title = 'SUAS';
$page_description = "Photo credit: Matthew D'Souza";
$nav_home = true;
$hero_title = 'Sydney University Astronomy Society';
$hero_credit = 'Photos from our stargazing trips and events';
$hero_slides = true;
$page_scripts = ['assets/js/submit.js'];

require __DIR__ . '/includes/layout/header.php';
?>

  <section class="section section--intro">
    <div class="wrap">
      <div class="title-row">
        <h2>2026 Astrophotography Competition</h2>

        <!-- The upload form is opened as a dialog by submit.js. It is not
             rendered flat on the page because the page is mostly an invitation
             and a gallery; the form is a detour you take deliberately. The
             dialog needs JavaScript, and so does the form itself -- it posts to
             upload.php from this page -- so nothing usable is hidden from anyone
             by putting it behind a click. -->
        <button type="button" class="button button--lg" id="open-upload" aria-haspopup="dialog" aria-controls="upload-modal">Upload your photos</button>
      </div>

      <noscript>
        <p class="hint">Uploading needs JavaScript, because the photos go straight from this page to our upload service. Email us instead and we will add them for you: <a href="mailto:usydastronomy@gmail.com">usydastronomy@gmail.com</a></p>
      </noscript>
    </div>
  </section>

  <section class="section section--flush" id="sent-in">
    <div class="wrap">
      <div class="rail-head">
        <p class="lede">A gallery of photos sent in thus far as shown below. Click on a photo to see full size + more info.</p>

        <!-- The arrows are revealed by main.js only when the rail actually
             overflows; without JavaScript the rail is still swipeable and
             scrollable, so nothing is lost. They share the line with the
             sentence rather than sitting on a row of their own above it. -->
        <div class="rail__nav" id="rail-nav" hidden>
          <button type="button" id="rail-prev" aria-controls="rail" aria-label="Previous photos">&#8249;</button>
          <button type="button" id="rail-next" aria-controls="rail" aria-label="More photos">&#8250;</button>
        </div>
      </div>

      <!-- Where the result of a successful upload is reported. The upload
           dialog closes on success so the submitter can see the photos they
           just sent, which leaves this as the only place left to say that it
           worked. Outside the generated markers, so the rail splice never
           touches it. -->
      <p class="rail__note" id="rail-note" role="status" hidden></p>

      <div class="rail" id="rail" tabindex="0" role="region" aria-label="Photos sent in thus far">
<?= photo_rail_markup(photo_all('queue')) ?>

      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <h2>Stargazing Trips</h2>
      <p class="lede">We organise trips out of Sydney to get to areas of low light pollution, giving you the best conditions for stargazing. There are two kinds of trips we organise: single night trips, and camping trips.</p>

      <div class="cards">
        <article class="card">
          <h3><img src="assets/img/icon-single-night.png" alt="">Single Night Trips</h3>
          <p>Time poor? Hate camping? Not to worry, our single night trips wrap up early enough that you can get home before bedtime.</p>
          <p>We hold one of these each semester.</p>
        </article>

        <article class="card">
          <h3><img src="assets/img/icon-camping.png" alt="">Camping Trips</h3>
          <p>If camping is your jam, then come to our camping trips! We stay at a site overnight so we can get as much time stargazing as possible. We hold these during the mid-semester and semester breaks.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <h2>On Campus Events</h2>
      <p class="lede">Long car rides and camping at late hours not your idea of fun? Don&rsquo;t worry, we also hold events so that you can enjoy astronomy from the comfort of the university.</p>

      <div class="cards">
        <article class="card">
          <h3><img src="assets/img/icon-solar.png" alt="">Solar Astronomy</h3>
          <p>View the sun through our solar telescope! We bring it out on occasion, giving you the opportunity to observe sunspots and solar activity.</p>
        </article>

        <article class="card">
          <h3><img src="assets/img/icon-stargazing.png" alt="">Local Stargazing</h3>
          <p>Stargaze on Campus! Despite Sydney&rsquo;s light pollution, there are plenty of things you can see in the night sky with a telescope. Take a look through ours!</p>
        </article>

        <article class="card">
          <h3><img src="assets/img/icon-trivia.png" alt="">Trivia</h3>
          <p>Test out your astronomical and general knowledge at one of our trivia nights. Grab a beer, and you might make some friends along the way.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section" id="join">
    <div class="wrap">
      <h2>Become a member</h2>
      <p class="lede">Membership is open to all University of Sydney students. Signing up gets you onto our mailing list so you hear about stargazing trips, camping trips and on-campus events before they fill up.</p>

      <div class="cards">
        <article class="card">
          <h3>Join online</h3>
          <p>The quickest way to join is through the University of Sydney Union club page, which handles membership and payments.</p>
          <p><a href="https://usu.edu.au/clubs/suas">Join via the USU club page &rarr;</a></p>
        </article>

        <article class="card">
          <h3>Come to a meeting</h3>
          <p>No experience needed. Come along to one of our general meetings, or just turn up to a stargazing night and say hello.</p>
          <p><a href="https://www.facebook.com/usydastronomy/">See upcoming events on Facebook &rarr;</a></p>
        </article>

        <article class="card">
          <h3>Questions?</h3>
          <p>Email us and we&rsquo;ll help you get sorted, including arranging transport to trips.</p>
          <p><a href="mailto:usydastronomy@gmail.com">usydastronomy@gmail.com</a></p>
        </article>
      </div>
    </div>
  </section>

  <section class="section section--banner" id="photos">
    <div class="wrap">
      <h2>Photo Gallery</h2>
      <p class="lede">A selection of photos from our stargazing trips and on-campus events. Select any photo to view it larger.</p>
      <div class="gallery">
<?= photo_gallery_markup(photo_all('gallery')) ?>

      </div>
    </div>
  </section>

<!-- Native <dialog>, so Escape, focus trapping and the backdrop come from the
     browser rather than from script. -->
<dialog class="modal" id="upload-modal" aria-labelledby="upload-modal-title">
  <div class="modal__panel">
    <div class="modal__head">
      <h2 id="upload-modal-title">Send us your photos!</h2>
      <button type="button" class="modal__close" id="close-upload" aria-label="Close">&#10005;</button>
    </div>

    <!-- Where the photos go. upload.php is this site's own endpoint: it
         validates the submission and files it in the rail, and there is no
         credential in this page because there is nothing here that needs one. -->
    <form class="submit-form modal__body" id="photo-form" method="post" action="upload.php" enctype="multipart/form-data" novalidate>

      <!-- The drop target is a label for the file input, so a click opens the
           picker without any JavaScript. The input sits inside it, off-screen
           but still focusable and still named: that is what keeps the keyboard
           and screen-reader paths working, and what lets the label light up
           when the input has focus. submit.js adds the dragging half of the
           gesture. -->
      <label class="dropzone" id="dropzone" for="photos">
        <svg class="dropzone__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15.2a3.2 3.2 0 0 1-3.2-3.2A3.2 3.2 0 0 1 12 8.8a3.2 3.2 0 0 1 3.2 3.2 3.2 3.2 0 0 1-3.2 3.2M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9m3 5c2.76 0 5 2.24 5 5s-2.24 5-5 5-5-2.24-5-5 2.24-5 5-5z"/></svg>
        <span class="dropzone__text">Drag photos here, or click to choose</span>
        <input class="sr-only" type="file" id="photos" name="photos[]" accept="image/jpeg,image/png,image/webp" multiple aria-label="Photos">
      </label>

      <ul class="previews" id="previews" aria-live="polite"></ul>

      <div class="fields">
        <div class="field">
          <label for="name">Your Name</label>
          <input type="text" id="name" name="name" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" autocomplete="email" required>
        </div>
      </div>

      <!-- Labelled "Other Details" because that is what it is to the person
           filling the form in. It is published as the photo's caption, which
           is the name the lightbox uses for it. -->
      <div class="field">
        <label for="caption">Other Details</label>
        <textarea id="caption" name="caption" rows="3" placeholder="Photo details, camera specs, etc."></textarea>
      </div>

      <div class="field field--check">
        <input type="checkbox" id="consent" name="consent" value="1" required>
        <label for="consent">I took these photos or have permission to share them, and anyone pictured is happy for them to appear on this site.</label>
      </div>
    </form>

    <div class="modal__foot">
      <p class="form-status" id="status" role="status"></p>

      <div class="form-actions">
        <!-- Sits outside the form so it can live in the footer that does not
             scroll; the form attribute is what still submits the form. -->
        <button type="submit" form="photo-form" class="button button--lg" id="send">Send my photos</button>
      </div>
    </div>
  </div>
</dialog>

<?php require __DIR__ . '/includes/layout/footer.php'; ?>
