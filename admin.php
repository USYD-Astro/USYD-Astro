<?php
declare(strict_types=1);

/**
 * The caretaker's page: sign in, see what has been sent in, and decide what
 * happens to it.
 *
 * Two lists, which are the two directories:
 *
 *   Sent in                 photos/queue/  -- promote one to the gallery, or bin it
 *   Home page gallery       photos/        -- send one back, or bin it
 *
 * Promoting used to mean moving an entry from submissions.yml to gallery.yml by
 * hand and letting a workflow rebuild the page. It is now a move between two
 * directories, and the gallery, the rail and the slideshow follow from that on
 * the next request.
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
            switch ($action) {
                case 'publish':
                    if (photo_publish($file)) {
                        $message = sprintf('%s is now on the home page gallery.', $file);
                    } else {
                        $error = 'That photo is not in the queue.';
                    }
                    break;

                case 'unpublish':
                    if (photo_unpublish($file)) {
                        $message = sprintf('%s is back in the rail, with its slide removed.', $file);
                    } else {
                        $error = 'That photo is not on the home page gallery.';
                    }
                    break;

                case 'delete':
                    if (photo_delete($file, 'Deleted from the admin page')) {
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
$gallery = photo_all('gallery');
?>
<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SUAS - Gallery admin</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="assets/img/logo.png">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body class="admin">

<main class="admin__wrap">
  <p class="admin__back"><a href="index.php">&larr; Back to the site</a></p>
  <h1>Gallery admin</h1>

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

  <form method="post" class="admin__logout">
    <input type="hidden" name="action" value="logout">
    <button type="submit" class="button button--ghost">Sign out</button>
  </form>

  <h2 class="admin__heading">Sent in <span class="admin__count"><?= count($queued) ?></span></h2>
  <p class="admin__meta">These appear in the rail on the home page. Add one to the gallery when you want it in the slideshow and the photo gallery.</p>

<?php if ($queued === []): ?>
  <p class="admin__meta">Nothing has been sent in yet.</p>
<?php else: ?>
  <div class="admin__grid">
<?php foreach ($queued as $photo): ?>
    <figure class="admin__card">
      <img src="<?= e(photo_thumb_url('queue', $photo['file'])) ?>" alt="" loading="lazy">
      <figcaption>
        <p class="admin__file"><?= e($photo['file']) ?></p>
        <p class="admin__detail">
          <?= e($photo['credit'] !== '' ? $photo['credit'] : 'no credit') ?>
          &middot; <?= e($photo['date'] !== '' ? $photo['date'] : 'no date') ?>
          &middot; <?= e(human_bytes($photo['bytes'])) ?>
        </p>
<?php if ($photo['caption'] !== ''): ?>
        <p class="admin__detail admin__caption"><?= e($photo['caption']) ?></p>
<?php endif; ?>
        <form method="post" class="admin__actions">
          <input type="hidden" name="csrf" value="<?= e($_SESSION['csrf']) ?>">
          <input type="hidden" name="file" value="<?= e($photo['file']) ?>">
          <button type="submit" class="button" name="action" value="publish">Add to gallery</button>
          <button type="submit" class="button button--danger" name="action" value="delete" data-confirm="Delete <?= e($photo['file']) ?>? This cannot be undone.">Delete</button>
        </form>
      </figcaption>
    </figure>
<?php endforeach; ?>
  </div>
<?php endif; ?>

  <h2 class="admin__heading">Home page gallery <span class="admin__count"><?= count($gallery) ?></span></h2>
  <p class="admin__meta">These fill the hero slideshow and the photo gallery. Sending one back leaves it in the rail with its slide removed.</p>

<?php if ($gallery === []): ?>
  <p class="admin__meta">The gallery is empty. Photos sent in through the form appear above.</p>
<?php else: ?>
  <div class="admin__grid">
<?php foreach ($gallery as $photo): ?>
    <figure class="admin__card">
      <img src="<?= e(photo_thumb_url('gallery', $photo['file'])) ?>" alt="" loading="lazy">
      <figcaption>
        <p class="admin__file"><?= e($photo['file']) ?></p>
        <p class="admin__detail">
          <?= e($photo['credit'] !== '' ? $photo['credit'] : 'no credit') ?>
          &middot; <?= e($photo['date'] !== '' ? $photo['date'] : 'no date') ?>
          &middot; <?= e(human_bytes($photo['bytes'])) ?>
        </p>
        <form method="post" class="admin__actions">
          <input type="hidden" name="csrf" value="<?= e($_SESSION['csrf']) ?>">
          <input type="hidden" name="file" value="<?= e($photo['file']) ?>">
          <button type="submit" class="button button--ghost" name="action" value="unpublish">Send back</button>
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
/* A delete is irreversible, so ask first. Kept here rather than in main.js: it is
   the only page that needs it, and this page loads no public scripts. */
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
