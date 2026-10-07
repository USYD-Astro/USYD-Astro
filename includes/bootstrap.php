<?php
declare(strict_types=1);

/**
 * Shared bootstrap: where things live, how the site is configured, and the
 * handful of helpers every page needs.
 *
 * The site is plain PHP served straight out of public_html. There is no build
 * step, no manifest and no CI. What the old pipeline generated ahead of time --
 * the hero band, the gallery grid, the submitted-photo rail -- is rendered from
 * the photographs themselves when a page is asked for, and the upload endpoint
 * writes its own thumbnails, so the only thing that has to stay in step is the
 * photographs.
 *
 * There are two collections, and the difference is the whole curation story:
 *
 *   photos/        the home page gallery, chosen by hand
 *   photos/queue/  what people have sent in, shown in the rail
 *
 * A submitted photo reaches the home page by being promoted from one to the
 * other, which is what the admin page does. Nothing else decides it.
 *
 * Anything that must not be published lives one level above the web root, in a
 * data directory beside public_html: the admin password hash, the credit lines
 * and captions, the removals log and the record of who sent what.
 */

define('APP_ROOT', dirname(__DIR__));

define('GALLERY_DIR', APP_ROOT . '/photos');
define('GALLERY_THUMBS', GALLERY_DIR . '/thumbs');
define('GALLERY_SLIDES', GALLERY_DIR . '/slides');

define('QUEUE_DIR', APP_ROOT . '/photos/queue');
define('QUEUE_THUMBS', QUEUE_DIR . '/thumbs');

/** Alternative text for a photo on the home page. */
define('GALLERY_ALT', 'Photo from a previous SUAS event');
/** Alternative text for one that came in through the form. */
define('QUEUE_ALT', 'Photo sent in by a SUAS member');

require_once __DIR__ . '/photos.php';

/**
 * Set SUAS_CONFIG to point at another config file, e.g. for a local preview.
 * On the server it is ~/suas-config.php, beside public_html rather than in it.
 */
$suas_config_path = getenv('SUAS_CONFIG') ?: dirname(APP_ROOT) . '/suas-config.php';

$GLOBALS['suas_config'] = array_merge(
    [
        'data_dir' => dirname(APP_ROOT) . '/suas-data',
        'admin_password_hash' => '',
        'max_photos_per_upload' => 8,
        // The page refuses anything larger before sending, so this is the same
        // ceiling stated twice: see the MAX_BYTES note in assets/js/submit.js.
        'max_upload_bytes' => 12 * 1048576,
        'max_pixels' => 60000000,
    ],
    is_readable($suas_config_path) ? (array) require $suas_config_path : []
);

function config(string $key): mixed
{
    return $GLOBALS['suas_config'][$key] ?? null;
}

/**
 * The private data directory, created on first use.
 *
 * Deliberately 0700: it holds contributors' email addresses and the reasons
 * photos were taken down, and nothing other than this account has any business
 * reading them.
 */
function data_dir(): string
{
    $dir = (string) config('data_dir');
    if ($dir !== '' && !is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}

/** Escape a value for HTML output. Every interpolation in a page goes through this. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/**
 * An attribute value, safely quoted.
 *
 * Credits and captions are written by members rather than by us, and they are
 * the one thing in the generated markup that cannot be assumed markup-free.
 * Runs of whitespace are collapsed too: a caption is a sentence, not a layout.
 */
function attr(?string $value): string
{
    $collapsed = preg_replace('/\s+/u', ' ', (string) $value) ?? '';
    return htmlspecialchars(trim($collapsed), ENT_QUOTES, 'UTF-8');
}

/** Human-readable byte count, used on the admin page's photo lists. */
function human_bytes(int $bytes): string
{
    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 1) . ' MB';
    }
    return max(1, (int) round($bytes / 1024)) . ' kB';
}

/** Whether this request arrived over HTTPS, for the admin session cookie. */
function is_https(): bool
{
    return (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
