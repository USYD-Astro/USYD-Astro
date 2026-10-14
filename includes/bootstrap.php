<?php
declare(strict_types=1);

/**
 * Shared bootstrap: where things live, how the site is configured, and the
 * handful of helpers every page needs.
 *
 * The site is plain PHP served straight out of public_html. There is no build
 * step, no manifest and no CI. What the old pipeline generated ahead of time --
 * the hero band and the gallery grid -- is rendered from the photographs
 * themselves when a page is asked for, and the upload endpoint writes its own
 * thumbnails, so the only thing that has to stay in step is the photographs.
 *
 * There are three collections, and the difference is the whole curation story:
 *
 *   photos/                the home page gallery, chosen by hand, which also
 *                          feeds the hero slideshow
 *   photos/submissions/    what people have sent in, once a committee member
 *                          has accepted it: the strip on the home page
 *   photos/queue/          what people have sent in, waiting to be reviewed
 *
 * Accepting what somebody sent in moves it from the queue into the submissions
 * strip, and that is as far as it goes: a submission does not enter the curated
 * gallery, so it never reaches the hero slideshow. Only a photo placed in
 * photos/ by hand is curated. Nothing shows a queued photo to a visitor -- the
 * review page is the one place it can be seen, and .htaccess refuses the
 * directory it sits in.
 *
 * Anything that must not be published lives one level above the web root, in a
 * data directory beside public_html: the admin password hash, the credit lines
 * and captions, the removals log and the record of who sent what.
 */

define('APP_ROOT', dirname(__DIR__));

define('GALLERY_DIR', APP_ROOT . '/photos');
define('GALLERY_THUMBS', GALLERY_DIR . '/thumbs');
define('GALLERY_SLIDES', GALLERY_DIR . '/slides');

define('SUBMISSIONS_DIR', APP_ROOT . '/photos/submissions');
define('SUBMISSIONS_THUMBS', SUBMISSIONS_DIR . '/thumbs');

define('QUEUE_DIR', APP_ROOT . '/photos/queue');
define('QUEUE_THUMBS', QUEUE_DIR . '/thumbs');

/** Alternative text for a photo on the home page gallery. */
define('GALLERY_ALT', 'Photo from a previous SUAS event');
/** Alternative text for one somebody sent in and a committee member accepted. */
define('SUBMISSIONS_ALT', 'Photo sent in by a SUAS member');
/** Alternative text for one that is still waiting to be reviewed. */
define('QUEUE_ALT', 'Photo sent in by a SUAS member, waiting to be reviewed');

require_once __DIR__ . '/photos.php';
require_once __DIR__ . '/events.php';
require_once __DIR__ . '/mail.php';

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

        // Where the notification's link points. A whole URL rather than the
        // request's own host, because the message is written on the way out of
        // an upload and there is no browser reading it to resolve a relative one.
        'site_url' => 'https://usydastro.org',

        // Who is told when a submission arrives. This is a placeholder for the
        // committee's own inbox and is meant to be set in ~/suas-config.php:
        // see includes/config.example.php.
        'notify_email' => 'murray@usydcanoeclub.org',

        // A second copy of every submission notification. The committee asked
        // for the club's published Gmail to see the notices alongside the
        // private inbox; set this to '' in ~/suas-config.php to stop that copy.
        'notify_email_cc' => 'usydastronomy@gmail.com',

        // What the notification comes from. Has to be an address on this
        // account's own domain, or the host will not send it and SPF will not
        // vouch for it.
        'notify_from' => 'photos@usydastro.org',

        // A ceiling on how many notifications an hour may leave the site. The
        // upload endpoint is public, and mail on every POST from an open form is
        // a way to fill somebody's inbox from a script. 0 turns the cap off.
        'notify_max_per_hour' => 20,
    ],
    is_readable($suas_config_path) ? (array) require $suas_config_path : []
);

function config(string $key): mixed
{
    return $GLOBALS['suas_config'][$key] ?? null;
}

/**
 * The hash the site's password is verified against, or '' when none is set.
 *
 * '' is not "accept anything": every caller reads it as "nothing can be
 * administered here", which is what a checkout without ~/suas-config.php gets.
 */
function admin_password_hash(): string
{
    return (string) config('admin_password_hash');
}

/**
 * Whether $password is the site's password.
 *
 * One password, checked in one place. The sign-in on the admin page and the
 * delete control in the photo viewer both come through here, so the two cannot
 * drift apart into different passwords.
 */
function admin_password_ok(string $password): bool
{
    $hash = admin_password_hash();
    return $hash !== '' && password_verify($password, $hash);
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

/**
 * A local asset's URL with its modification time attached.
 *
 * The host serves .css with a week-long max-age and the pages keep the same
 * asset addresses forever, so a browser that has seen the stylesheet once will
 * not ask for it again: a change to the CSS arrives up to seven days late, on a
 * page whose markup changed immediately. That is not cosmetic. The strip of
 * sent-in photos is styled entirely by rules added to style.css, so a returning
 * visitor was shown the new markup dressed by the old stylesheet.
 *
 * The mtime gives the file a new address exactly when it changes, and only then,
 * which keeps the cache useful at the same time as making it harmless. An
 * absolute URL is somebody else's to version, so it is returned untouched.
 */
function asset_url(string $path): string
{
    if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $path) === 1 || str_starts_with($path, '//')) {
        return $path;
    }
    $file = APP_ROOT . '/' . ltrim($path, '/');
    $stamp = is_file($file) ? filemtime($file) : false;
    return $stamp === false ? $path : $path . '?v=' . $stamp;
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
