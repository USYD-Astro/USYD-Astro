<?php
declare(strict_types=1);

/**
 * Removal endpoint for the control in the photo viewer.
 *
 * The committee member who opens a photo can take it off the site from there,
 * which is the same flow the relay's /moderate endpoint served. What is different
 * is that the password is now real. It was previously a speed bump on purpose --
 * the page said so in a comment, because a static page cannot hold a secret and
 * nothing on the other end would have checked it. This endpoint is not a static
 * page: it verifies the password against the hash in ~/suas-config.php and does
 * the removal itself, so the photo is off the site the moment the button is
 * pressed rather than on the next build.
 *
 * The reason the committee member gives is written to removals.log beside the web
 * root, with the filename and the time, which is the record the old flow kept in
 * the repository.
 */

require __DIR__ . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** Answer with a message the viewer can show, and stop. */
function moderate_answer(bool $ok, string $message, int $status = 200): void
{
    http_response_code($status);
    echo json_encode(
        $ok ? ['ok' => true, 'message' => $message] : ['ok' => false, 'error' => $message],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    moderate_answer(false, 'Removals have to be posted.', 405);
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== (string) ($_SERVER['HTTP_HOST'] ?? '')) {
    moderate_answer(false, 'This has to be sent from the SUAS site itself.', 403);
}

$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    moderate_answer(false, 'That request could not be read.', 400);
}

$file = basename((string) ($payload['filename'] ?? ''));
$reason = trim((string) ($payload['reason'] ?? ''));
$password = (string) ($payload['password'] ?? '');

if ($file === '' || !preg_match('/^\d{2,}\.[A-Za-z0-9]+$/', $file)) {
    moderate_answer(false, 'That is not a photo this site stores.', 400);
}

$passwordHash = (string) config('admin_password_hash');

/* Check the password before saying anything about the photo, so a wrong password
   cannot be used to find out which filenames exist. */
if ($passwordHash === '' || !password_verify($password, $passwordHash)) {
    usleep(500000); // slows guessing down; shared hosting has no fail2ban to lean on
    moderate_answer(false, 'That password was not right.', 403);
}

if (!photo_delete($file, $reason)) {
    moderate_answer(false, 'That photo was not in the gallery.', 404);
}

moderate_answer(true, basename($file) . ' has been taken off the site.');
