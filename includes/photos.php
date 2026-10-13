<?php
declare(strict_types=1);

/**
 * The photo store.
 *
 * There is no manifest any more. A photo is a file, and which collection its
 * directory puts it in is what it means:
 *
 *   photos/                the home page gallery, curated by hand, which also
 *                          feeds the hero slideshow
 *   photos/submissions/    sent in through the form and accepted: the strip on
 *                          the home page, and as far as a submission goes
 *   photos/queue/          sent in through the form, waiting to be reviewed
 *
 * Accepting a photo moves the file from the queue to submissions and no
 * further, so a member's photo reaches the strip and not the curated gallery or
 * the slideshow. That replaces moving an entry between two YAML files and
 * regenerating markup, and it means the collections cannot disagree with what is
 * actually published.
 *
 * The queue is private. Nothing here renders it as a public block, .htaccess
 * refuses photos/queue/ outright, and the review page reads it through PHP: a
 * photo nobody has accepted yet is not on the site.
 *
 * The little that is not in the pixels -- the credit, the caption and the date a
 * photo arrived -- lives in photos.json in the data directory above the web root.
 * Numbers are never reused: see photo_reserve_number().
 */

/** Photo file extensions the site will show. Thumbnails are always written as .jpg. */
function photo_suffixes(): array
{
    return ['jpg', 'jpeg', 'png', 'webp'];
}

/**
 * Where a collection keeps its files.
 *
 * The queue has no slides directory: a submitted photo is not in the home page
 * slideshow, and it does not get one until it is accepted.
 */
function photo_dirs(string $collection): array
{
    if ($collection === 'queue') {
        return ['dir' => QUEUE_DIR, 'thumbs' => QUEUE_THUMBS, 'slides' => ''];
    }
    if ($collection === 'submissions') {
        return ['dir' => SUBMISSIONS_DIR, 'thumbs' => SUBMISSIONS_THUMBS, 'slides' => ''];
    }
    return ['dir' => GALLERY_DIR, 'thumbs' => GALLERY_THUMBS, 'slides' => GALLERY_SLIDES];
}

function photo_path(string $collection, string $file): string
{
    return photo_dirs($collection)['dir'] . '/' . basename($file);
}

function photo_thumb_path(string $collection, string $file): string
{
    $stem = pathinfo(basename($file), PATHINFO_FILENAME);
    return photo_dirs($collection)['thumbs'] . '/' . $stem . '.jpg';
}

/** The hero slide. Only a photo on the home page gallery has one. */
function photo_slide_path(string $file): string
{
    return GALLERY_SLIDES . '/' . pathinfo(basename($file), PATHINFO_FILENAME) . '.jpg';
}

function photo_full_url(string $collection, string $file): string
{
    return photo_dir_prefix($collection) . basename($file);
}

function photo_thumb_url(string $collection, string $file): string
{
    return photo_dir_prefix($collection) . 'thumbs/' . basename(photo_thumb_path($collection, $file));
}

/** The URL each collection is served from, which decides what a visitor can reach. */
function photo_dir_prefix(string $collection): string
{
    return match ($collection) {
        'queue' => 'photos/queue/',
        'submissions' => 'photos/submissions/',
        default => 'photos/',
    };
}

function photo_slide_url(string $file): string
{
    return 'photos/slides/' . basename(photo_slide_path($file));
}

/* ------------------------------------------------------------- metadata -- */

/**
 * The credit lines, captions and dates, plus the number counter.
 *
 * Read on every page render and written on every upload, promotion or removal.
 * A missing or unreadable file is not an error: photos without entries still
 * appear, with the default alternative text for their collection, because the
 * photographs are the source of truth and this is the decoration around them.
 */
function photo_metadata(): array
{
    $path = data_dir() . '/photos.json';
    $decoded = is_readable($path) ? json_decode((string) file_get_contents($path), true) : null;
    if (!is_array($decoded)) {
        return ['next' => 1, 'used' => [], 'photos' => []];
    }
    // The set of numbers ever handed out, sorted. It outlives the photographs
    // themselves, which is the point: see photo_reserve_number().
    $used = array_values(array_unique(array_map('intval', (array) ($decoded['used'] ?? []))));
    sort($used);
    return [
        'next' => max(1, (int) ($decoded['next'] ?? 1)),
        'used' => $used,
        'photos' => is_array($decoded['photos'] ?? null) ? $decoded['photos'] : [],
    ];
}

/** Write the metadata atomically, so a failed write cannot truncate it. */
function photo_metadata_save(array $meta): void
{
    $dir = data_dir();
    if ($dir === '') {
        return;
    }
    $json = json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $temp = $dir . '/photos.json.tmp';
    file_put_contents($temp, $json . "\n", LOCK_EX);
    @chmod($temp, 0640);
    rename($temp, $dir . '/photos.json');
}

/* --------------------------------------------------------------- reading -- */

/**
 * Every photo in one collection, in the order it should be shown.
 *
 * Sorted by the filename's stem, naturally, so 09.jpg comes before 10.jpg
 * rather than after it, which is the order the old manifests listed them in.
 */
function photo_all(string $collection = 'gallery'): array
{
    $dirs = photo_dirs($collection);
    if (!is_dir($dirs['dir'])) {
        return [];
    }
    $metadata = photo_metadata()['photos'];
    $defaultAlt = match ($collection) {
        'queue' => QUEUE_ALT,
        'submissions' => SUBMISSIONS_ALT,
        default => GALLERY_ALT,
    };
    $photos = [];

    foreach (scandir($dirs['dir']) as $name) {
        if ($name === '.' || $name === '..') {
            continue;
        }
        $path = $dirs['dir'] . '/' . $name;
        if (!is_file($path)) {
            continue; // thumbs/, slides/, queue/ and anything else that is not a photo
        }
        if (!in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), photo_suffixes(), true)) {
            continue;
        }
        $meta = $metadata[$name] ?? [];
        $photos[] = [
            'file' => $name,
            'stem' => pathinfo($name, PATHINFO_FILENAME),
            'collection' => $collection,
            'alt' => (string) ($meta['alt'] ?? $defaultAlt),
            'credit' => (string) ($meta['credit'] ?? ''),
            'caption' => (string) ($meta['caption'] ?? ''),
            'date' => (string) ($meta['date'] ?? ''),
            'bytes' => (int) filesize($path),
        ];
    }

    usort(
        $photos,
        static fn (array $a, array $b): int => strnatcasecmp($a['stem'], $b['stem'])
    );
    return $photos;
}

/** One photo by filename, in whichever collection holds it. */
function photo_find(string $file): ?array
{
    $wanted = basename($file);
    /* Numbers are never handed out twice, so a filename belongs to exactly one
       of these; the order only decides which is looked at first. */
    foreach (['gallery', 'submissions', 'queue'] as $collection) {
        foreach (photo_all($collection) as $photo) {
            if ($photo['file'] === $wanted) {
                return $photo;
            }
        }
    }
    return null;
}

/* --------------------------------------------------------------- markup -- */

/**
 * The home page gallery grid: one button per curated photo.
 *
 * The indentation and the attributes match what tools/gallery.py used to write
 * into index.html, because this replaced a generated block at the same depth and
 * the lightbox reads data-full.
 */
function photo_gallery_markup(array $photos): string
{
    $lines = [];
    foreach ($photos as $photo) {
        $lines[] = sprintf(
            '        <button type="button"><img src="%s" data-full="%s" alt="%s"></button>',
            attr(photo_thumb_url('gallery', $photo['file'])),
            attr(photo_full_url('gallery', $photo['file'])),
            attr($photo['alt'])
        );
    }
    return implode("\n", $lines);
}

/**
 * The strip of photos people have sent in, as it appears on the home page.
 *
 * Only accepted photos are here. A submission still waiting for review is not
 * rendered anywhere, and the review page builds its own list because the one
 * thing a queued photo needs is an accept and a reject button beside it.
 *
 * The credit, caption and date travel as data attributes on the image the
 * lightbox opens, which is how the expanded view can show who sent a photo and
 * what they said about it without anything being fetched separately.
 */
function photo_submissions_markup(array $photos): string
{
    if ($photos === []) {
        return '        <p class="submissions__empty">Nothing has been sent in yet, yours could be '
            . 'the first! Use the button above to add your photos to this gallery.</p>';
    }

    $lines = [];
    foreach ($photos as $photo) {
        $bits = [
            sprintf('src="%s"', attr(photo_thumb_url('submissions', $photo['file']))),
            sprintf('data-full="%s"', attr(photo_full_url('submissions', $photo['file']))),
        ];
        foreach (['credit', 'caption', 'date'] as $key) {
            if ($photo[$key] !== '') {
                $bits[] = sprintf('data-%s="%s"', $key, attr($photo[$key]));
            }
        }
        $bits[] = sprintf('alt="%s"', attr($photo['alt']));
        $lines[] = '        <button type="button" class="submissions__item"><img '
            . implode(' ', $bits) . '></button>';
    }
    return implode("\n", $lines);
}

/**
 * The hero band's crossfading slides, one figure per curated photo.
 *
 * Slides reuse the 480 px thumbnails on small screens via srcset and load the
 * 1280 px derivative the rest of the time. Only the first slide is eager, so
 * nothing above the fold waits on the rest, and only the first carries
 * is-current, which is what a visitor without JavaScript sees.
 */
function photo_hero_markup(array $photos): string
{
    $lines = [];
    foreach ($photos as $i => $photo) {
        $lines[] = sprintf(
            '    <figure class="hero__slide%s"><img src="%s" srcset="%s 480w, %s 1280w" sizes="100vw" loading="%s" alt="%s"></figure>',
            $i === 0 ? ' is-current' : '',
            attr(photo_slide_url($photo['file'])),
            attr(photo_thumb_url('gallery', $photo['file'])),
            attr(photo_slide_url($photo['file'])),
            $i === 0 ? 'eager' : 'lazy',
            attr($photo['alt'])
        );
    }
    return implode("\n", $lines);
}

/* --------------------------------------------------------------- images -- */

/** Load a JPEG, PNG or WebP into a truecolour GD image. */
function photo_load(string $path): GdImage
{
    $info = @getimagesize($path);
    if ($info === false) {
        throw new RuntimeException('that file is not an image');
    }

    $image = match ($info[2]) {
        IMAGETYPE_JPEG => @imagecreatefromjpeg($path),
        IMAGETYPE_PNG => @imagecreatefrompng($path),
        IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false,
        default => false,
    };
    if ($image === false) {
        throw new RuntimeException('that image could not be read');
    }

    // A truecolour copy simplifies everything downstream, but the original
    // palette is destroyed by the conversion, so copy before flattening.
    if (!imageistruecolor($image)) {
        $truecolour = imagecreatetruecolor(imagesx($image), imagesy($image));
        imagecopy($truecolour, $image, 0, 0, 0, 0, imagesx($image), imagesy($image));
        imagedestroy($image);
        $image = $truecolour;
    }
    return $image;
}

/**
 * Apply the EXIF orientation tag.
 *
 * GD ignores the tag rather than honouring it, so a portrait phone photo comes
 * out sideways unless it is rotated here by hand, from the file, before the
 * re-encode throws the tag away.
 */
function photo_apply_orientation(GdImage $image, string $sourcePath): GdImage
{
    if (!function_exists('exif_read_data')) {
        return $image;
    }
    $exif = @exif_read_data($sourcePath);
    $orientation = (int) ($exif['Orientation'] ?? 1);

    return match ($orientation) {
        2 => photo_flip($image, IMG_FLIP_HORIZONTAL),
        3 => photo_rotate($image, 180),
        4 => photo_flip($image, IMG_FLIP_VERTICAL),
        5 => photo_flip(photo_rotate($image, -90), IMG_FLIP_HORIZONTAL),
        6 => photo_rotate($image, -90),
        7 => photo_flip(photo_rotate($image, 90), IMG_FLIP_HORIZONTAL),
        8 => photo_rotate($image, 90),
        default => $image,
    };
}

function photo_rotate(GdImage $image, float $degrees): GdImage
{
    $rotated = imagerotate($image, $degrees, 0);
    if ($rotated === false) {
        return $image;
    }
    imagedestroy($image);
    return $rotated;
}

function photo_flip(GdImage $image, int $mode): GdImage
{
    imageflip($image, $mode);
    return $image;
}

/**
 * Write a bounded, metadata-free JPEG.
 *
 * The re-encode is the privacy step as much as the resizing is. The page sends
 * whatever came off the camera -- the current form deliberately does not shrink
 * or scrub on the way out -- so this is where GPS coordinates and every other
 * tag stop being published. GD writes brand new bytes; nothing from the original
 * file survives into the copy the site serves.
 *
 * The bound is max width against four times that in height, which is what
 * tools/gallery.py used; it keeps originals small without cropping.
 */
function photo_write_jpeg(GdImage $image, string $destination, int $edge, int $quality): void
{
    $width = imagesx($image);
    $height = imagesy($image);
    $scale = min(1.0, $edge / max(1, $width), ($edge * 4) / max(1, $height));
    $targetWidth = max(1, (int) round($width * $scale));
    $targetHeight = max(1, (int) round($height * $scale));

    $canvas = imagecreatetruecolor($targetWidth, $targetHeight);
    imagecopyresampled($canvas, $image, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
    imageinterlace($canvas, true); // progressive, as the old pipeline wrote

    if (!is_dir(dirname($destination))) {
        mkdir(dirname($destination), 0755, true);
    }
    $written = imagejpeg($canvas, $destination, $quality);
    imagedestroy($canvas);

    if ($written === false) {
        throw new RuntimeException('the resized photo could not be saved');
    }
    @chmod($destination, 0644);
}

/* -------------------------------------------------------------- writing -- */

/** Serialise the whole store: allocate a number, write files, record metadata. */
function photo_with_lock(callable $work): mixed
{
    $lock = fopen(data_dir() . '/photos.lock', 'c');
    if ($lock === false) {
        throw new RuntimeException('the data directory is not writable');
    }
    flock($lock, LOCK_EX);
    try {
        return $work();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * Take a number and never give it back.
 *
 * A removed photo's name is spent. The old pipeline went out of its way to
 * enforce this, and the reason still holds: the number is on a URL that search
 * engines and anyone who shared the link have already cached against a
 * photograph somebody asked to have taken down. Handing that number to the next
 * upload would serve a different photo from the same address.
 *
 * A spent number has to be remembered, not merely inferred from what is on
 * disk: the whole problem is a number whose file is gone. Here that memory is
 * the `used` list in photos.json, which the seed carries over from every number
 * the manifests and git history ever mentioned. The on-disk check stays as a
 * backstop for a photos.json that was lost, so a number still in use can never
 * be handed to a second photo even then.
 *
 * Held under the store's lock by the caller, so two uploads cannot both claim
 * the same number.
 */
function photo_reserve_number(array &$metadata): int
{
    $number = max(1, (int) $metadata['next']);
    $spent = array_flip($metadata['used']);
    $taken = static function (int $n) use ($spent): bool {
        if (isset($spent[$n])) {
            return true;
        }
        // Every extension the store shows, not only .jpg and .png: a number
        // whose file is still on disk in any of them is still in use, and
        // photo_thumb_path() names a thumbnail after the stem alone, so two
        // files sharing a number would share one thumbnail as well.
        foreach (photo_suffixes() as $suffix) {
            $name = sprintf('%02d.%s', $n, $suffix);
            if (is_file(GALLERY_DIR . '/' . $name)
                || is_file(SUBMISSIONS_DIR . '/' . $name)
                || is_file(QUEUE_DIR . '/' . $name)
            ) {
                return true;
            }
        }
        return false;
    };
    while ($taken($number)) {
        $number++;
    }
    $metadata['next'] = $number + 1;
    $metadata['used'][] = $number;
    sort($metadata['used']);
    return $number;
}

/**
 * Store one uploaded photo in the queue, and return its entry.
 *
 * A thumbnail is derived but no hero slide: a submitted photo is not in the home
 * page slideshow. The slide is made when somebody promotes it.
 */
function photo_add_to_queue(string $sourcePath, array $meta): array
{
    return photo_with_lock(function () use ($sourcePath, $meta): array {
        $image = photo_apply_orientation(photo_load($sourcePath), $sourcePath);
        $metadata = photo_metadata();
        $number = photo_reserve_number($metadata);
        $file = sprintf('%02d.jpg', $number);

        $written = [];
        try {
            photo_write_jpeg($image, photo_path('queue', $file), 1600, 82);
            $written[] = photo_path('queue', $file);
            photo_write_jpeg($image, photo_thumb_path('queue', $file), 480, 78);
            $written[] = photo_thumb_path('queue', $file);
        } catch (Throwable $error) {
            foreach ($written as $path) {
                @unlink($path);
            }
            imagedestroy($image);
            throw $error;
        }
        imagedestroy($image);

        $metadata['photos'][$file] = array_filter([
            'alt' => (string) ($meta['alt'] ?? ''),
            'credit' => (string) ($meta['credit'] ?? ''),
            'caption' => (string) ($meta['caption'] ?? ''),
            'date' => (string) ($meta['date'] ?? ''),
        ], static fn ($value): bool => $value !== '');
        photo_metadata_save($metadata);

        return photo_find($file);
    });
}

/**
 * Accept a submitted photo: move it out of the private queue and into the strip
 * of what people have sent in, which is part of the home page.
 *
 * There is no hero slide and no gallery: the strip is where a submission goes
 * and where it stays. A member's photo therefore reaches the page the moment a
 * committee member accepts it, and reaches the slideshow only if somebody later
 * chooses to curate it by hand.
 */
function photo_accept(string $file): bool
{
    return photo_with_lock(function () use ($file): bool {
        $file = basename($file);
        $from = photo_path('queue', $file);
        if (!is_file($from)) {
            return false;
        }
        if (!is_dir(SUBMISSIONS_DIR)) {
            mkdir(SUBMISSIONS_DIR, 0755, true);
        }
        if (!rename($from, photo_path('submissions', $file))) {
            return false;
        }
        photo_rename_thumb('queue', 'submissions', $file);
        return true;
    });
}

/**
 * Move a queued photo into the curated gallery, and build its hero slide.
 *
 * The review page does not call this, and should not: accepting a submission
 * puts it in the strip and leaves it there. The curated gallery is maintained by
 * hand, and this is the one thing that can produce the thumbnail-width copy and
 * the 1280px slide a photo in photos/ needs, both derived from the stored copy
 * rather than from the original upload, which no longer exists anywhere. Run it
 * against a queued photo as the last step of curating one by hand.
 */
function photo_publish(string $file): bool
{
    return photo_with_lock(function () use ($file): bool {
        $file = basename($file);
        $from = photo_path('queue', $file);
        if (!is_file($from)) {
            return false;
        }
        if (!is_dir(GALLERY_DIR)) {
            mkdir(GALLERY_DIR, 0755, true);
        }
        if (!rename($from, photo_path('gallery', $file))) {
            return false;
        }
        photo_rename_thumb('queue', 'gallery', $file);

        $image = photo_load(photo_path('gallery', $file));
        try {
            photo_write_jpeg($image, photo_slide_path($file), 1280, 80);
        } finally {
            imagedestroy($image);
        }
        return true;
    });
}

/**
 * Send a photo back to the pending list: the inverse of photo_accept(), and the
 * way a curated photo is taken off the home page without being deleted.
 *
 * Either public collection can be sent back, and both end up in the private
 * queue with their thumbnail. A curated photo also loses its hero slide, because
 * the slideshow only ever shows what is in photos/; a submission never had one.
 */
function photo_unpublish(string $file): bool
{
    return photo_with_lock(function () use ($file): bool {
        $file = basename($file);
        $photo = photo_find($file);
        if ($photo === null || $photo['collection'] === 'queue') {
            return false;
        }
        $collection = $photo['collection'];
        $from = photo_path($collection, $file);
        if (!is_file($from)) {
            return false;
        }
        if (!is_dir(QUEUE_DIR)) {
            mkdir(QUEUE_DIR, 0755, true);
        }
        if (!rename($from, photo_path('queue', $file))) {
            return false;
        }
        photo_rename_thumb($collection, 'queue', $file);
        if ($collection === 'gallery' && is_file(photo_slide_path($file))) {
            @unlink(photo_slide_path($file));
        }
        return true;
    });
}

/**
 * Move a thumbnail between collections, where one exists to move.
 *
 * The destination's thumbs/ directory is created here rather than by each
 * caller, because rename() into a directory that does not exist fails without
 * saying so: the thumbnail would be left behind in the collection the photo just
 * left, and the one it arrived in would render a tile pointing at a file that is
 * not there. A collection's thumbs/ only usually exists because something was
 * moved into it before, which is exactly the case that hides this.
 */
function photo_rename_thumb(string $from, string $to, string $file): void
{
    $source = photo_thumb_path($from, $file);
    if (!is_file($source)) {
        return;
    }
    $target = photo_thumb_path($to, $file);
    if (!is_dir(dirname($target))) {
        mkdir(dirname($target), 0755, true);
    }
    rename($source, $target);
}

/**
 * Remove a photo from whichever collection holds it.
 *
 * Deleting is a takedown: someone asks for their photo to come down and it comes
 * down, here and now. No branch, no workflow, no waiting for the next build.
 */
function photo_delete(string $file, string $reason = ''): bool
{
    return photo_with_lock(function () use ($file, $reason): bool {
        $photo = photo_find($file);
        if ($photo === null) {
            return false;
        }
        $collection = $photo['collection'];
        $paths = [photo_path($collection, $photo['file']), photo_thumb_path($collection, $photo['file'])];
        if ($collection === 'gallery') {
            $paths[] = photo_slide_path($photo['file']);
        }
        foreach ($paths as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }

        $metadata = photo_metadata();
        unset($metadata['photos'][$photo['file']]);
        photo_metadata_save($metadata);

        photo_log_removal([
            'removed' => date('c'),
            'file' => $photo['file'],
            'credit' => $photo['credit'],
            'reason' => $reason,
        ]);
        return true;
    });
}

/* ----------------------------------------------------------------- logs -- */

/** Append one JSON record to a log in the private data directory. */
function photo_append_log(string $name, array $record): void
{
    $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($line === false) {
        return;
    }
    $path = data_dir() . '/' . $name;
    file_put_contents($path, $line . "\n", FILE_APPEND | LOCK_EX);
    @chmod($path, 0640);
}

/**
 * Record who sent what, for takedown requests and credit corrections.
 *
 * This is the one thing here that is nobody else's business, which is why it is
 * a file beside the web root rather than a branch in a public repository -- which
 * is where the old design put submitter email addresses, whatever it intended.
 */
function photo_log_submission(array $record): void
{
    photo_append_log('submissions.log', $record);
}

/** Record that a photo came down, and why. */
function photo_log_removal(array $record): void
{
    photo_append_log('removals.log', $record);
}
