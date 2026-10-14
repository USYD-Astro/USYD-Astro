<?php
declare(strict_types=1);

/**
 * The caretaker's page: sign in, see what has been sent in, and decide what
 * happens to it.
 *
 * Three lists, which are the three directories:
 *
 *   Pending review      photos/queue/        -- accept one, or reject it
 *   Photos sent in      photos/submissions/  -- on the home page: move to the
 *                                                gallery, or delete
 *   Home page gallery   photos/              -- curated by hand: move to the
 *                                                photos sent in, or delete
 *
 * The queue is private. It is not rendered anywhere on the site, and .htaccess
 * refuses photos/queue/ outright, because a filename like 03.jpg is a guess away
 * and "not linked to" is not the same as "not published". That is why the first
 * list reads its thumbnails back through this script, which checks the session
 * first, instead of linking to the files. The other two are public and are
 * linked to directly.
 *
 * Accepting is a move from the queue into the sent-in strip and no further, so a
 * member's photo reaches the home page without reaching the curated gallery or
 * the hero slideshow. That is the judgement "someone moves its entry there by
 * hand" used to stand for, with two YAML files and a workflow behind it.
 *
 * The password hash lives in ~/suas-config.php, outside the web root, next to the
 * contact log and the removals log. Nothing here is published: the page sends
 * noindex, keeps out of caches, and shows nothing but filenames, credits and
 * dates.
 */

require __DIR__ . '/includes/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store, must-revalidate');

session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => is_https(),
]);
session_start();

$passwordHash = admin_password_hash();
$notifyTo = suas_notify_recipient();
$message = '';
$error = '';

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function admin_signed_in(): bool
{
    return !empty($_SESSION['admin']);
}

/** Reject a form post that did not come from this page's own markup. */
function admin_csrf_ok(): bool
{
    $token = (string) ($_POST['csrf'] ?? '');
    return $token !== '' && hash_equals((string) $_SESSION['csrf'], $token);
}

/**
 * Send one queued photo's thumbnail, to a signed-in session and nobody else.
 *
 * .htaccess answers 404 for all of photos/queue/, so the list below cannot link
 * to a file there. It asks this instead, and this checks the session before it
 * reads anything: an unreviewed photo is not on the site, and the point of the
 * review step is that nobody sees one until somebody here accepts it.
 *
 * A query on this script rather than a second file, because the sign-in, the
 * session and the password hash are already here, and a separate endpoint would
 * be a second copy of them to keep in step.
 */
function admin_send_pending_thumb(string $file): void
{
    /* basename() as well as the pattern: the two together are what make this
       safe whatever arrives in the query string. */
    $name = basename($file);
    if (preg_match('/^\d{2,}\.[A-Za-z0-9]+$/', $name) !== 1) {
        http_response_code(404);
        exit;
    }

    /* 403 rather than 404 when signed out: the filename came from this page, so
       there is nothing to hide about the photo existing -- only about what it
       looks like. */
    if (!admin_signed_in()) {
        http_response_code(403);
        exit;
    }

    $path = photo_thumb_path('queue', $name);
    /* is_readable as well as is_file: the read below is the whole point of this
       function, and a file that is present but unreadable would answer with a
       warning and no bytes instead of a clean 404. */
    if (!is_file($path) || !is_readable($path)) {
        http_response_code(404);
        exit;
    }

    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, no-store', true);
    readfile($path);
    exit;
}

/** Where the review page asks for a queued photo's thumbnail: see above. */
function admin_pending_thumb_url(string $file): string
{
    return 'admin.php?pending=' . rawurlencode(basename($file));
}

/** The one-line detail under a photo's filename: only the pieces that exist. */
function admin_detail_line(array $photo): string
{
    $parts = array_filter(
        [(string) ($photo['credit'] ?? ''), (string) ($photo['date'] ?? ''), human_bytes((int) ($photo['bytes'] ?? 0))],
        fn (string $part): bool => $part !== ''
    );
    return implode(' · ', $parts);
}

/* No session, no image: this runs before the POST handling below, and before
   anything is written to the response.

   is_string() rather than isset(), because a query string can carry
   pending[]= and hand an array to something expecting a filename, which is a
   PHP warning per request from anyone who cares to ask. Anything that is not a
   plain string was never a filename. */
if (is_string($_GET['pending'] ?? null)) {
    admin_send_pending_thumb($_GET['pending']);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = (string) ($_POST['action'] ?? '');

    if ($action === 'login') {
        /* Every wrong guess costs the attacker half a second, and more once they
           have been wrong a few times. Shared hosting has no fail2ban we can rely
           on, so the delay is the cheap version of one. */
        $failures = (int) ($_SESSION['login_failures'] ?? 0);
        usleep($failures >= 5 ? 1500000 : 400000);

        if (admin_password_ok((string) ($_POST['password'] ?? ''))) {
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['login_failures'] = 0;
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        } else {
            $_SESSION['login_failures'] = $failures + 1;
            $error = 'That password was not right.';
        }
    } elseif ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: admin.php');
        exit;
    } elseif (admin_signed_in()) {
        if (!admin_csrf_ok()) {
            $error = 'That request expired. Please try again.';
        } else {
            $file = basename((string) ($_POST['file'] ?? ''));
            /* Which collection the photo is really in, rather than which list
               the button was pressed in: the two cannot disagree, and the log
               line should say what actually happened. */
            $found = photo_find($file);
            $collection = $found === null ? '' : $found['collection'];

            switch ($action) {
                case 'accept':
                    if (photo_accept($file)) {
                        $message = sprintf('%s is now in the photos sent in on the home page.', $file);
                    } else {
                        $error = 'That photo is not waiting for review.';
                    }
                    break;

                case 'move_to_gallery':
                    if (photo_move($file, 'gallery')) {
                        $message = sprintf('%s is now in the home page gallery, and in the slideshow.', $file);
                    } else {
                        $error = 'That photo is not in the photos sent in.';
                    }
                    break;

                case 'move_to_submissions':
                    if (photo_move($file, 'submissions')) {
                        $message = sprintf('%s is now in the photos sent in, and off the slideshow.', $file);
                    } else {
                        $error = 'That photo is not in the gallery.';
                    }
                    break;

                case 'delete':
                    /* One action, three events. Rejecting a submission, taking
                       an accepted one down again and removing a curated photo
                       are different things to whoever reads removals.log later. */
                    $reason = match ($collection) {
                        'queue' => 'Rejected from the review page',
                        'submissions' => 'Deleted from the photos sent in',
                        'gallery' => 'Deleted from the gallery admin page',
                        default => 'Deleted from the admin page',
                    };
                    if (photo_delete($file, $reason)) {
                        $message = sprintf('%s and its thumbnails were deleted.', $file);
                    } else {
                        $error = 'That photo was not found.';
                    }
                    break;

                default:
                    $error = 'That is not something this page does.';
            }
        }
    }
}

$queued = photo_all('queue');
$submissions = photo_all('submissions');
$gallery = photo_all('gallery');
?>
<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SUAS Admin</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="assets/img/logo.png">
<link rel="stylesheet" href="<?= attr(asset_url('assets/css/style.css')) ?>">
</head>
<body class="admin">

<main class="admin__wrap">
  <p class="admin__back"><a href="index.php">&larr; Back to the site</a></p>
  <div class="admin__head">
    <h1>Admin</h1>
<?php if (admin_signed_in()): ?>
    <form method="post" class="admin__logout">
      <input type="hidden" name="action" value="logout">
      <button type="submit" class="button button--ghost">Sign out</button>
    </form>
<?php endif; ?>
  </div>

<?php if ($message !== ''): ?>
  <p class="admin__flash admin__flash--ok"><?= e($message) ?></p>
<?php endif; ?>
<?php if ($error !== ''): ?>
  <p class="admin__flash admin__flash--bad"><?= e($error) ?></p>
<?php endif; ?>

<?php if (!admin_signed_in()): ?>

  <?php if ($passwordHash === ''): ?>
    <div class="notice">
      <p><strong>No admin password is set.</strong> Create <code>~/suas-config.php</code> beside <code>public_html</code> with an <code>admin_password_hash</code> in it — <code>includes/config.example.php</code> explains how. Until then this page lets nobody in, and neither does the remove control in the photo viewer.</p>
    </div>
  <?php else: ?>
    <form class="admin__login" method="post">
      <input type="hidden" name="action" value="login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" autofocus required>
      <button type="submit" class="button">Sign in</button>
    </form>
  <?php endif; ?>

<?php else: ?>

  <h2 class="admin__heading">Pending review <span class="admin__count"><?= count($queued) ?></span></h2>
  <p class="admin__meta">Nobody can see these yet. Accepting one adds it to the photos sent in on the home page; rejecting deletes it.</p>
<?php if ($notifyTo !== ''): ?>
  <p class="admin__meta">Each submission also emails <code><?= e($notifyTo) ?></code>.</p>
<?php endif; ?>

<?php if ($queued === []): ?>
  <p class="admin__meta">Nothing is waiting for review.</p>
<?php else: ?>
  <div class="admin__grid">
<?php foreach ($queued as $photo): ?>
    <figure class="admin__card">
      <img src="<?= e(admin_pending_thumb_url($photo['file'])) ?>" alt="" loading="lazy">
      <figcaption>
        <p class="admin__file"><?= e($photo['file']) ?></p>
        <p class="admin__detail"><?= e(admin_detail_line($photo)) ?></p>
<?php if ($photo['caption'] !== ''): ?>
        <p class="admin__detail admin__caption"><?= e($photo['caption']) ?></p>
<?php endif; ?>
        <form method="post" class="admin__actions">
          <input type="hidden" name="csrf" value="<?= e($_SESSION['csrf']) ?>">
          <input type="hidden" name="file" value="<?= e($photo['file']) ?>">
          <button type="submit" class="button" name="action" value="accept">Accept</button>
          <button type="submit" class="button button--danger" name="action" value="delete" data-confirm="Reject <?= e($photo['file']) ?>? The photo is deleted and cannot be recovered.">Reject</button>
        </form>
      </figcaption>
    </figure>
<?php endforeach; ?>
  </div>
<?php endif; ?>

  <h2 class="admin__heading">Photos sent in <span class="admin__count"><?= count($submissions) ?></span></h2>
  <p class="admin__meta">These are on the home page now, in the strip below the competition blurb. Move one to the gallery to curate it as well, or delete it to take it down.</p>

<?php if ($submissions === []): ?>
  <p class="admin__meta">Nothing has been accepted yet.</p>
<?php else: ?>
  <div class="admin__grid">
<?php foreach ($submissions as $photo): ?>
    <figure class="admin__card">
      <img src="<?= e(photo_thumb_url('submissions', $photo['file'])) ?>" alt="" loading="lazy">
      <figcaption>
        <p class="admin__file"><?= e($photo['file']) ?></p>
        <p class="admin__detail"><?= e(admin_detail_line($photo)) ?></p>
<?php if ($photo['caption'] !== ''): ?>
        <p class="admin__detail admin__caption"><?= e($photo['caption']) ?></p>
<?php endif; ?>
        <form method="post" class="admin__actions">
          <input type="hidden" name="csrf" value="<?= e($_SESSION['csrf']) ?>">
          <input type="hidden" name="file" value="<?= e($photo['file']) ?>">
          <button type="submit" class="button button--ghost" name="action" value="move_to_gallery" data-confirm="Move <?= e($photo['file']) ?> to the home page gallery? It joins the photo gallery and the hero slideshow.">Move To Gallery</button>
          <button type="submit" class="button button--danger" name="action" value="delete" data-confirm="Delete <?= e($photo['file']) ?> from the photos sent in? This cannot be undone.">Delete</button>
        </form>
      </figcaption>
    </figure>
<?php endforeach; ?>
  </div>
<?php endif; ?>

  <h2 class="admin__heading">Home page gallery <span class="admin__count"><?= count($gallery) ?></span></h2>
  <p class="admin__meta">These fill the hero slideshow and the photo gallery. They are curated by hand: move one to the photos sent in if it was placed here by mistake, or delete it to take it off the site.</p>

<?php if ($gallery === []): ?>
  <p class="admin__meta">The gallery is empty.</p>
<?php else: ?>
  <div class="admin__grid">
<?php foreach ($gallery as $photo): ?>
    <figure class="admin__card">
      <img src="<?= e(photo_thumb_url('gallery', $photo['file'])) ?>" alt="" loading="lazy">
      <figcaption>
        <p class="admin__file"><?= e($photo['file']) ?></p>
        <p class="admin__detail"><?= e(admin_detail_line($photo)) ?></p>
        <form method="post" class="admin__actions">
          <input type="hidden" name="csrf" value="<?= e($_SESSION['csrf']) ?>">
          <input type="hidden" name="file" value="<?= e($photo['file']) ?>">
          <button type="submit" class="button button--ghost" name="action" value="move_to_submissions" data-confirm="Move <?= e($photo['file']) ?> to the photos sent in? It leaves the photo gallery and the hero slideshow.">Move To Submissions</button>
          <button type="submit" class="button button--danger" name="action" value="delete" data-confirm="Delete <?= e($photo['file']) ?> from the gallery? This cannot be undone.">Delete</button>
        </form>
      </figcaption>
    </figure>
<?php endforeach; ?>
  </div>
<?php endif; ?>

<?php endif; ?>
</main>

<script>
/* A delete is irreversible and a move changes the public home page the moment it
   is pressed, so both ask first. Kept here rather than in main.js: it is the
   only page that needs it, and this page loads no public scripts. */
document.querySelectorAll("[data-confirm]").forEach(function (button) {
  button.addEventListener("click", function (event) {
    if (!window.confirm(button.dataset.confirm)) {
      event.preventDefault();
    }
  });
});
</script>
</body>
</html>
