<?php
declare(strict_types=1);

/**
 * Configuration for the SUAS site.
 *
 * This file does NOT live in the repository or in public_html. On the server it
 * is `~/suas-config.php`, one level above the web root, so that the admin
 * password hash and the data directory are never web-reachable and never
 * published by a deploy.
 *
 * To create it:
 *
 *   1. Generate a password hash:
 *
 *        php -r 'echo password_hash("your-new-password", PASSWORD_DEFAULT), PHP_EOL;'
 *
 *   2. Copy this file to ~/suas-config.php and paste the hash into
 *      'admin_password_hash'. Set 'data_dir' to the absolute path of a
 *      directory next to public_html.
 *
 * Nothing here is secret except the hash, but all of it is private: keep it out
 * of the web root regardless.
 *
 * The defaults below are what the site falls back to when a key is missing, so
 * a checkout without a config file still renders its pages for local preview.
 * Uploads and the admin page need a real config.
 */

return [
    // password_verify() against this. Empty means the admin page refuses to log
    // anyone in rather than accepting any password.
    'admin_password_hash' => '',

    // Photographs' credit lines and the log of who sent what. Must be outside
    // public_html -- it holds contributors' email addresses.
    'data_dir' => '/home/usydbojn/suas-data',

    // Upload limits. The page refuses anything outside these before sending, so
    // they are both the same ceiling stated twice -- see the MAX_BYTES note in
    // assets/js/submit.js -- and a backstop for anything that reaches the
    // endpoint another way. Keep .user.ini's post_max_size above the largest
    // batch these allow, or PHP discards the request before upload.php sees it.
    'max_photos_per_upload' => 8,
    'max_upload_bytes' => 12 * 1024 * 1024,
    'max_pixels' => 60000000,
];
