<?php
declare(strict_types=1);

/**
 * Photo upload endpoint.
 *
 * This is the whole job the Cloudflare Worker used to do, done in the request
 * that receives the file. The relay existed because GitHub Pages cannot accept an
 * upload and no credential that can write to a repository belongs in a public
 * page; PHP can just take the upload, so the token, the branch, the workflow and
 * the second service are all gone.
 *
 * What it still checks, because the relay checked it and the reasons have not
 * changed: same origin, consent, a name, a reply address, at most eight photos, a
 * sane size and pixel count, and a real image behind the extension. All of it is
 * checked before anything is stored, so a bad batch leaves nothing behind.
 *
 * Photos land in the queue -- the rail on the home page -- not in the curated
 * gallery. That is the same separation the two manifests used to express, and it
 * stays a human decision: the admin page promotes the ones that belong in the
 * gallery. The submitter's name is their credit, as it was before.
 *
 * The photograph is re-encoded by includes/photos.php on the way in, which is
 * where EXIF is dropped. The page sends the original file, metadata and all, so
 * this is the only place that scrubs it -- and it does, because GD writes new
 * bytes rather than copying the upload through.
 */

require __DIR__ . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

/**
 * Answer with an error the form can show, and stop.
 *
 * The shape matches what assets/js/submit.js has always expected -- {ok, error}
 * with a non-2xx status -- so the page needed no rework to talk to this endpoint.
 */
function upload_fail(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Trim, drop control characters and cap the length of a text field.
 *
 * The cap is by character, not by byte: names and captions may be in any script,
 * and cutting one mid-codepoint would leave invalid UTF-8 that json_encode then
 * refuses to write. mbstring does it directly where it is installed; where it is
 * not, preg_split on the character boundaries is the same thing at this size.
 *
 * The page sends the details inside the `meta` JSON rather than as one field per
 * input, so that is where they are read from; a hand-written post of the form
 * itself sends them as ordinary fields, so those are taken first when present.
 */
function upload_text(array $meta, string $key, int $limit): string
{
    $value = (string) ($_POST[$key] ?? $meta[$key] ?? '');
    $value = preg_replace('/[\x00-\x1F\x7F]/u', '', $value) ?? '';
    $value = trim($value);

    if (function_exists('mb_substr')) {
        return trim(mb_substr($value, 0, $limit));
    }
    $characters = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return trim(implode('', array_slice($characters, 0, $limit)));
}

/**
 * The submission's details, which the form sends as one JSON field.
 *
 * Kept in the shape the page already builds, so nothing about how it is written
 * had to change, and so the extra fields it carries have somewhere to go.
 */
function upload_meta(): array
{
    $decoded = json_decode((string) ($_POST['meta'] ?? ''), true);
    return is_array($decoded) ? $decoded : [];
}

/** Re-shape $_FILES['photos'] into one flat record per file. */
function upload_files(): array
{
    if (!isset($_FILES['photos'])) {
        return [];
    }
    $incoming = $_FILES['photos'];

    /* A single file arrives as a scalar rather than a list if anything ever
       posts the field without the [] suffix, which a hand-written client is
       perfectly capable of doing. */
    if (!is_array($incoming['name'])) {
        return [[
            'name' => (string) $incoming['name'],
            'tmp' => (string) $incoming['tmp_name'],
            'size' => (int) $incoming['size'],
            'error' => (int) $incoming['error'],
        ]];
    }

    $files = [];
    foreach ($incoming['name'] as $i => $name) {
        $files[] = [
            'name' => (string) $name,
            'tmp' => (string) ($incoming['tmp_name'][$i] ?? ''),
            'size' => (int) ($incoming['size'][$i] ?? 0),
            'error' => (int) ($incoming['error'][$i] ?? UPLOAD_ERR_NO_FILE),
        ];
    }
    return $files;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    upload_fail(405, 'Photos are uploaded, not fetched.');
}

/* Only this site's own forms may post here. A missing Origin is allowed because
   the endpoint is also useful from curl during a deploy check; a wrong one is
   not, or any other site could use our disk as its own image host. */
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
$requestHost = (string) parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
if ($origin !== '' && strcasecmp((string) parse_url($origin, PHP_URL_HOST), $requestHost) !== 0) {
    upload_fail(403, 'This form has to be sent from the SUAS site itself.');
}

/* An oversized body is discarded by PHP before we are called, which leaves no
   $_POST and no $_FILES at all -- indistinguishable from an empty submission
   unless we look at the content length. */
if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    upload_fail(
        413,
        'That upload was larger than the server accepts. Please send fewer photos at a time.'
    );
}

$meta = upload_meta();
$name = upload_text($meta, 'name', 120);
$email = upload_text($meta, 'email', 200);
$caption = upload_text($meta, 'caption', 1000);

/* The form has no credit field: the name the submitter gives is what their
   photos are published under, which is the fallback the old publishing step
   applied too. */
$credit = $name;

/* The page sends the checkbox as a boolean inside the meta JSON; a hand-written
   post of the form itself would send it as an ordinary field instead, so take
   either. */
$consent = ($meta['consent'] ?? null) === true || ($_POST['consent'] ?? '') === '1';
if (!$consent) {
    upload_fail(400, 'Please confirm the consent box before sending.');
}
if ($name === '') {
    upload_fail(400, 'Please give a name — it is how your photos are credited.');
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    upload_fail(400, 'We need an email address so we can reply.');
}

$files = upload_files();
$maxPhotos = (int) config('max_photos_per_upload');
$maxBytes = (int) config('max_upload_bytes');
$maxPixels = (int) config('max_pixels');
$allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

if (count($files) < 1) {
    upload_fail(400, 'Choose at least one photo first.');
}
if (count($files) > $maxPhotos) {
    upload_fail(
        400,
        sprintf('Please choose at most %d photos at a time — you sent %d. Send them in a couple of batches.', $maxPhotos, count($files))
    );
}

/* ---- validate everything before storing anything ------------------------- */

$finfo = new finfo(FILEINFO_MIME_TYPE);
$checked = [];

foreach ($files as $index => $file) {
    $position = $index + 1;

    if ($file['error'] === UPLOAD_ERR_NO_FILE) {
        upload_fail(400, sprintf('Photo %d did not arrive. Please try again.', $position));
    }
    if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) {
        upload_fail(413, sprintf('Photo %d is larger than the server accepts. Try a smaller one.', $position));
    }
    if ($file['error'] !== UPLOAD_ERR_OK) {
        upload_fail(400, sprintf('Photo %d could not be uploaded. Please try again.', $position));
    }
    if (!is_uploaded_file($file['tmp'])) {
        upload_fail(400, sprintf('Photo %d did not arrive as an upload.', $position));
    }
    if ($file['size'] <= 0 || $file['size'] > $maxBytes) {
        upload_fail(413, sprintf('Photo %d is larger than %d MB, which is the most one photo can be.', $position, (int) round($maxBytes / 1048576)));
    }

    // Trust the bytes, not the filename: an image the browser named .jpg can be
    // anything at all.
    $type = $finfo->file($file['tmp']) ?: '';
    if (!in_array($type, $allowedTypes, true)) {
        upload_fail(400, sprintf('Photo %d is not a JPEG, PNG or WebP image.', $position));
    }

    $info = @getimagesize($file['tmp']);
    if ($info === false) {
        upload_fail(400, sprintf('Photo %d could not be read as an image.', $position));
    }
    if (($info[0] * $info[1]) > $maxPixels) {
        upload_fail(413, sprintf('Photo %d has too many pixels for the server to process. Please send a smaller version.', $position));
    }

    $checked[] = ['file' => $file, 'width' => (int) $info[0], 'height' => (int) $info[1]];
}

/* ---- store them in the queue -------------------------------------------- */

$stored = [];
$failed = 0;
foreach ($checked as $item) {
    try {
        $stored[] = photo_add_to_queue($item['file']['tmp'], [
            'credit' => $credit,
            'caption' => $caption,
            'date' => date('Y-m-d'),
        ]);
    } catch (Throwable $error) {
        $failed++;
    }
}

if ($stored === []) {
    upload_fail(500, 'The server could not save those photos. Please try again in a moment.');
}

photo_log_submission([
    'received' => date('c'),
    'name' => $name,
    'email' => $email,
    'credit' => $credit,
    'caption' => $caption,
    'files' => array_column($stored, 'file'),
    'ip' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
]);

$count = count($stored);
$message = match (true) {
    $count === 1 && $failed === 0 => 'Thanks — your photo is with us.',
    $count === 1 => 'Thanks — one photo is with us, but another could not be saved.',
    $failed > 0 => sprintf('Thanks — %d of %d photos are with us.', $count, $count + $failed),
    default => sprintf('Thanks — all %d photos are with us.', $count),
};

echo json_encode([
    'ok' => true,
    'message' => $message,
    'files' => array_column($stored, 'file'),
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
