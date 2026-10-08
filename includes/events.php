<?php
declare(strict_types=1);

/**
 * The society's own upcoming events, for the calendar on the home page.
 *
 * Nothing is scraped here. The Sydney Uni Canoe Club already reads our
 * Instagram the hard way -- their `outdoors/fetch_astro.py` reads the feed their
 * own bridge writes (a logged-out browser reads the profile and each post; the
 * narro.info mirror it replaced is gone), OCRs the event poster for the date,
 * venue and time, and merges the result into `outdoors/outdoors_cache.json` on a
 * Git cron every fifteen minutes -- and they publish that cache as a plain JSON
 * file. Fetching the events they have already extracted is the same data for
 * none of the duplication: the two clubs would otherwise keep two copies of one
 * scraper, and only one of them would be maintained.
 *
 * Their file also carries the mirror's own health -- whether the last crawl
 * succeeded (`astro_status`) and when it last read the profile
 * (`astro_meta.fetched_at`). Both are read here and surfaced by the page (see
 * astro_events_health()), because a calendar that quietly shows last month's
 * events is worse than one that admits it might be out of date.
 *
 * What that costs is a dependency, and it is worth naming: usydcanoeclub.org is
 * where the events come from, and if they stop publishing that file this page
 * shows nothing rather than something wrong. The last good response is kept on
 * disk and served while a fetch is failing, so a blip is invisible and a
 * permanent outage degrades to a stale calendar rather than an empty one.
 *
 * The cache is only ever a couple of kilobytes -- the source file is ~86kB,
 * most of which is a SUBW trip page we have no use for, so only the astronomy
 * keys are kept.
 */

/** Where the canoe club publish the mirrored feed's events. */
const EVENTS_SOURCE_URL = 'https://usydcanoeclub.org/outdoors/outdoors_cache.json';

/**
 * How long a response is trusted before another fetch is attempted.
 *
 * This is the page's own cache, not the source's refresh rate: the crawler
 * updates every fifteen minutes, so half an hour of staleness is invisible in
 * practice and keeps an event calendar from making an outbound request on
 * every visit.
 */
const EVENTS_TTL_SECONDS = 1800;

/** Outbound fetch budget. A visitor is waiting on this, so it is short. */
const EVENTS_TIMEOUT_SECONDS = 6;

/**
 * How old the mirror's last successful read may be before the calendar says so.
 *
 * The canoe club crawls every fifteen minutes, so hours of silence means the
 * pipeline upstream is broken rather than merely between runs. Six hours leaves
 * room for a slow CI queue without hiding a feed that is a day behind.
 */
const EVENTS_STALE_AFTER_SECONDS = 6 * 3600;

/** The cache file, in the private data directory beside public_html. */
function events_cache_path(): string
{
    $dir = data_dir();
    return $dir === '' ? '' : $dir . '/events-cache.json';
}

/**
 * The source's astronomy events and its own health, as this site reads them.
 *
 * Every failure -- no curl, a timeout, a non-200, a body that is not JSON, a
 * JSON body with no astronomy keys -- comes back as the empty shape, with no
 * events and no health. The caller renders what it gets; there is nothing a
 * visitor could do about a fetch that failed.
 */
function events_fetch_source(): array
{
    $body = events_http_get(EVENTS_SOURCE_URL);
    if ($body === null) {
        return events_source_shape([]);
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded) || !isset($decoded['astro_events']) || !is_array($decoded['astro_events'])) {
        return events_source_shape([]);
    }

    $events = [];
    foreach ($decoded['astro_events'] as $event) {
        if (is_array($event)) {
            $events[] = $event;
        }
    }

    $meta = is_array($decoded['astro_meta'] ?? null) ? $decoded['astro_meta'] : [];

    return events_source_shape($events, [
        'status' => (string) ($decoded['astro_status'] ?? ''),
        'error' => (string) ($decoded['astro_error'] ?? ''),
        'fetched_at' => (string) ($meta['fetched_at'] ?? ''),
    ]);
}

/** The one shape every caller reads from the source: the events and its health. */
function events_source_shape(array $events, array $health = []): array
{
    return [
        'events' => $events,
        'status' => (string) ($health['status'] ?? ''),
        'error' => (string) ($health['error'] ?? ''),
        'fetched_at' => (string) ($health['fetched_at'] ?? ''),
    ];
}

/**
 * One GET, through curl when it is there and the stream wrapper when it is not.
 *
 * Both are tried rather than picking one, and in that order, because they fail
 * differently and a shared host can lose either: php-curl without a usable CA
 * bundle fails every request while the stream wrapper succeeds, and a host with
 * curl disabled has only the stream wrapper. Neither path is fast to fail, so
 * the second attempt is only ever reached when the first has already given up.
 *
 * Both send a user agent: a bare PHP request is the kind of thing a firewall
 * blocks on sight.
 */
function events_http_get(string $url): ?string
{
    if (function_exists('curl_init')) {
        $body = events_curl_get($url);
        if ($body !== null) {
            return $body;
        }
    }

    return ini_get('allow_url_fopen') ? events_stream_get($url) : null;
}

/** The curl attempt. Null for every kind of failure, status included. */
function events_curl_get(string $url): ?string
{
    $handle = curl_init($url);
    if ($handle === false) {
        return null;
    }

    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => EVENTS_TIMEOUT_SECONDS,
        CURLOPT_TIMEOUT => EVENTS_TIMEOUT_SECONDS,
        CURLOPT_USERAGENT => events_user_agent(),
        // Anything but a 200 is a failure, including a redirect landing on their
        // 404 page. Without this curl hands the body back regardless.
        CURLOPT_FAILONERROR => true,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    return (is_string($body) && $status === 200) ? $body : null;
}

/**
 * The stream-wrapper attempt.
 *
 * The status has to be read off the *last* HTTP status line in
 * $http_response_header rather than the first: PHP appends one line per hop, so
 * after a redirect the first is the 301 and only the last says how the fetch
 * actually ended. Reading the first would refuse a perfectly good response.
 */
function events_stream_get(string $url): ?string
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => EVENTS_TIMEOUT_SECONDS,
            'user_agent' => events_user_agent(),
            'follow_location' => 1,
            'max_redirects' => 3,
            'ignore_errors' => true,
        ],
    ]);

    $body = @file_get_contents($url, false, $context);
    if (!is_string($body)) {
        return null;
    }

    $statuses = array_values(array_filter(
        $http_response_header ?? [],
        static fn (string $line): bool => stripos($line, 'HTTP/') === 0
    ));
    $last = $statuses === [] ? '' : (string) end($statuses);

    return strpos($last, ' 200 ') === false ? null : $body;
}

/** Names the site, so an operator reading their log knows who is asking. */
function events_user_agent(): string
{
    return 'usydastro.org events calendar (+https://usydastro.org/)';
}

/**
 * The astronomy events, newest fetch allowed and the last good one kept.
 *
 * The stored file carries the events and the time of the last *attempt*, not
 * the last success. A failing source therefore costs one fetch per TTL rather
 * than one per page view, which on a shared host matters -- an unreachable
 * upstream would otherwise turn every visit into a six-second wait.
 */
function astro_events(): array
{
    $path = events_cache_path();
    $stored = events_cache_read($path);
    $checked_at = (int) ($stored['checked_at'] ?? 0);
    $stored_source = is_array($stored['source'] ?? null) ? $stored['source'] : [];

    if ($checked_at > 0 && (time() - $checked_at) < EVENTS_TTL_SECONDS) {
        events_health_record($stored_source);
        return events_normalise($stored['events'] ?? []);
    }

    $fetched = events_fetch_source();
    if ($fetched['events'] === []) {
        // Keep whatever was last known good, and stamp the attempt so the next
        // visitor in this window does not pay for another timeout. The stored
        // health travels with it, so the calendar reports the mirror it last
        // heard from rather than going silent.
        events_health_record($stored_source);
        return events_normalise(events_cache_store($path, $stored['events'] ?? [], time(), $stored_source));
    }

    events_health_record($fetched);
    return events_normalise(events_cache_store($path, $fetched['events'], time(), $fetched));
}

/**
 * What the last read of the mirror knew about it, for the page to show.
 *
 * `stale` is true when the mirror reported a failed crawl, or when its last
 * successful read is older than EVENTS_STALE_AFTER_SECONDS. A source that says
 * nothing -- an older cache file with no health keys -- does not accuse the
 * calendar of being stale on no evidence.
 */
function astro_events_health(): array
{
    return events_health();
}

/** The mirror's health, remembered for the page after the fetch above. */
function events_health(?array $set = null): array
{
    static $health = ['status' => '', 'error' => '', 'fetched_at' => '', 'age_seconds' => null, 'stale' => false];
    if ($set !== null) {
        $health = $set;
    }
    return $health;
}

/** Judge one source reading and remember it for astro_events_health(). */
function events_health_record(array $source): void
{
    $fetched_at = (string) ($source['fetched_at'] ?? '');
    $timestamp = $fetched_at === '' ? false : strtotime($fetched_at);
    $age = $timestamp === false ? null : max(0, time() - $timestamp);

    events_health([
        'status' => (string) ($source['status'] ?? ''),
        'error' => (string) ($source['error'] ?? ''),
        'fetched_at' => $fetched_at,
        'age_seconds' => $age,
        'stale' => ((string) ($source['status'] ?? '') === 'error')
            || ($age !== null && $age > EVENTS_STALE_AFTER_SECONDS),
    ]);
}

/**
 * From the source's keys to the shape the page renders.
 *
 * A club that states no clock time leaves its event without one, and the tile
 * then drops the time prefix rather than inventing an hour -- the same rule the
 * canoe club's own calendar follows. An event with no usable date is dropped:
 * the grid has nowhere to put it, and a tile with no day would be worse than
 * its absence.
 */
function events_normalise(array $raw): array
{
    $today = new DateTimeImmutable('today');

    $events = [];
    foreach ($raw as $event) {
        if (!is_array($event)) {
            continue;
        }

        $date = (string) ($event['date'] ?? '');
        $day = events_parse_date($date);
        if ($day === null) {
            continue;
        }

        $start = events_clock((string) ($event['startTime'] ?? ''));
        $end = events_clock((string) ($event['endTime'] ?? ''));

        $events[] = [
            'title' => trim((string) ($event['title'] ?? '')) ?: 'SUAS event',
            'date' => $day->format('Y-m-d'),
            'startTime' => (string) ($event['startTime'] ?? ''),
            'endTime' => (string) ($event['endTime'] ?? ''),
            'timeLabel' => ($start !== '' && $end !== '') ? $start . ' - ' . $end : $start,
            'place' => trim((string) ($event['place'] ?? '')),
            'notes' => trim((string) ($event['notes'] ?? '')),
            'link' => events_safe_link((string) ($event['link'] ?? '')),
            'image' => events_safe_link((string) ($event['image'] ?? '')),
            // Handed to the client already sorted and already dated, so the
            // script has no date arithmetic of its own to get wrong.
            'past' => $day < $today,
        ];
    }

    usort($events, static function (array $a, array $b): int {
        return [$a['date'], $a['startTime'], $a['title']]
            <=> [$b['date'], $b['startTime'], $b['title']];
    });

    return $events;
}

/** A YYYY-MM-DD string as a date, or null if it is not one. */
function events_parse_date(string $value): ?DateTimeImmutable
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    return ($date !== false && $date->format('Y-m-d') === $value) ? $date : null;
}

/**
 * "17:00" shown the way the club writes it ("5pm").
 *
 * Mirrors the canoe club's own treatment, so the same event reads the same on
 * both calendars rather than one saying "5:00 PM" and the other "5pm".
 */
function events_clock(string $value): string
{
    if ($value === '') {
        return '';
    }

    $timestamp = strtotime($value);
    if ($timestamp === false) {
        return '';
    }

    return str_replace([':00am', ':00pm'], ['am', 'pm'], date('g:ia', $timestamp));
}

/** Only http(s) URLs reach the page, so a filed link cannot become javascript:. */
function events_safe_link(string $value): string
{
    $value = trim($value);
    $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
    return in_array($scheme, ['http', 'https'], true) ? $value : '';
}

/**
 * The events as a plain list, for the <noscript> half of the calendar.
 *
 * The month grid is JavaScript, so without it this is what a visitor gets: the
 * same events, in the same order, as sentences. Rendered from the same array
 * the grid is fed, so the two cannot disagree about what is on.
 */
function calendar_list_markup(array $events): string
{
    if ($events === []) {
        return '';
    }

    $rows = '';
    foreach ($events as $event) {
        $when = calendar_date_label($event['date']);
        if ($event['timeLabel'] !== '') {
            $when .= ', ' . $event['timeLabel'];
        }

        // The upstream title already ends in "at <venue>" for most events, so
        // the place is only spelled out when the title does not mention it.
        // Both fields are the same sentence otherwise.
        $where = ($event['place'] !== '' && stripos($event['title'], $event['place']) === false)
            ? ' at ' . e($event['place'])
            : '';

        $rows .= "\n        <li><strong>" . e($when) . '</strong> &mdash; ' . e($event['title']) . $where . "</li>";
    }

    return '<ul class="calendar__list">' . $rows . "\n      </ul>";
}

/** A stored date as "Fri 3 Oct 2026", for the list and the dialog's subtitle. */
function calendar_date_label(string $date): string
{
    $day = events_parse_date($date);
    return $day === null ? $date : $day->format('D j M Y');
}

/** The stored cache, or an empty one. */
function events_cache_read(string $path): array
{
    if ($path === '' || !is_readable($path)) {
        return [];
    }

    $decoded = json_decode((string) @file_get_contents($path), true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Write the events and the time of this attempt, and hand the events back.
 *
 * Called with the previous events even when the fetch failed, which is what
 * makes a failed attempt cost a timestamp rather than the calendar.
 */
function events_cache_store(string $path, array $events, int $checked_at, array $source = []): array
{
    $payload = ['checked_at' => $checked_at, 'events' => $events, 'source' => $source];

    if ($path !== '') {
        // Best effort. A data directory that cannot be written makes every page
        // view pay for a fetch, which is bad but not broken, so it is not worth
        // failing the page over.
        @file_put_contents($path, json_encode($payload), LOCK_EX);
    }

    return $events;
}
