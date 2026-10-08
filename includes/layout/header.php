<?php
declare(strict_types=1);

/**
 * Shared <head>, header bar and hero band, opening <main id="main"> on the way
 * out. Every page includes this, sets the variables below, and closes with
 * layout/footer.php.
 *
 *   $page_title        document title, and og:title unless one is given below
 *   $page_og_title     og:title when it is shorter than the document title
 *   $page_description  meta description, if the page has one
 *   $nav_home          mark the Home link as the current page
 *   $hero_title        the page's <h1>
 *   $hero_credit       small line under the <h1>, e.g. a photo credit
 *   $hero_image        single backdrop photo for the hero band
 *   $hero_slides       crossfade through the home page gallery instead
 *
 * Pages used to repeat this markup in full, which is what moving off static
 * hosting bought us the chance to stop doing.
 *
 * The body carries the moderation endpoint because the remove control in the
 * lightbox appears wherever a photo can be opened, not only on the page with
 * the upload form on it.
 */

$page_origin = $page_origin ?? 'https://usydastro.org';
$page_title = $page_title ?? 'SUAS';
$page_og_title = $page_og_title ?? $page_title;
$page_description = $page_description ?? '';
$nav_home = $nav_home ?? false;
$hero_title = $hero_title ?? $page_title;
$hero_credit = $hero_credit ?? '';
$hero_image = $hero_image ?? '';
$hero_slides = $hero_slides ?? false;

/* og:url and the canonical have to be absolute, and so does og:image: a relative
 * og:image is resolved against the consumer's own origin, not ours, so Facebook
 * and every other unfurler was fetching a URL that does not exist. index.php is
 * the directory index, so its canonical is the root rather than the filename. */
$page_path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$page_path = (string) preg_replace('~/index\.php$~', '/', $page_path);
if ($page_path === '') {
    $page_path = '/';
}
$page_url = $page_origin . $page_path;
?>
<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($page_title) ?></title>
<?php if ($page_description !== ''): ?>
<meta name="description" content="<?= e($page_description) ?>">
<?php endif; ?>
<link rel="icon" href="assets/img/logo.png">
<meta property="og:title" content="<?= e($page_og_title) ?>">
<meta property="og:type" content="website">
<meta property="og:url" content="<?= attr($page_url) ?>">
<meta property="og:image" content="<?= attr($page_origin . '/assets/img/og-image.png') ?>">
<?php if ($page_description !== ''): ?>
<meta property="og:description" content="<?= e($page_description) ?>">
<meta name="twitter:card" content="summary_large_image">
<?php endif; ?>
<link rel="canonical" href="<?= attr($page_url) ?>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
<script>
/* Two facts about this visit, decided before anything is painted.
 *
 * "js" drives the under-construction notice: with scripting it is a modal over
 * the page, and without it the same notice renders as a plain band at the top of
 * the document, so a visitor on a locked-down browser is still told.
 *
 * The session flag is read here rather than at the end of the document so that
 * somebody who has already dismissed the notice never sees it flash.
 */
try {
  document.documentElement.classList.add("js");
  if (sessionStorage.getItem("suas-construction-dismissed") === "1") {
    document.documentElement.classList.add("construction-dismissed");
  }
} catch (error) {
  /* Storage disabled (private mode): behave like a first-time visitor. */
  document.documentElement.classList.add("js");
}
</script>
</head>
<body data-moderate-endpoint="moderate.php">

<a class="skip" href="#main">Skip to main content</a>

<div class="construction" id="construction">
  <div class="construction__panel" role="alertdialog" aria-modal="true" aria-labelledby="construction-title" aria-describedby="construction-note">
    <p class="construction__title" id="construction-title">WEBSITE UNDER CONSTRUCTION</p>
    <p class="construction__note" id="construction-note">Shiny new astronomy club website coming soon!</p>
    <button type="button" class="button construction__dismiss" id="construction-dismiss">Got it</button>
  </div>
</div>

<header class="topbar">
  <div class="topbar__inner">
    <a class="brandmark" href="index.php">
      <img src="assets/img/logo.png" alt="">
      <span>Sydney Uni Astronomy Society</span>
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="Menu">&#9776;</button>
    <nav class="nav" id="primary-nav" aria-label="Primary">
      <a href="index.php"<?= $nav_home ? ' aria-current="page"' : '' ?>>Home</a>
      <a href="https://usu.edu.au/clubs/suas">Sign Up</a>
    </nav>
  </div>
</header>

<section class="hero">
<?php if ($hero_slides): ?>
  <div class="hero__slides" id="hero-slides">
<?= photo_hero_markup(photo_all('gallery')) ?>

  </div>
<?php else: ?>
  <div class="hero__bg" style="background-image:url('<?= attr($hero_image) ?>')"></div>
<?php endif; ?>
  <div class="hero__inner">
    <h1><?= e($hero_title) ?></h1>
<?php if ($hero_credit !== ''): ?>
    <p class="hero__credit"><?= e($hero_credit) ?></p>
<?php endif; ?>
  </div>
</section>

<main id="main">
