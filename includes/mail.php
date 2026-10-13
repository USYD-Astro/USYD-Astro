<?php
declare(strict_types=1);

/**
 * Telling somebody that a submission is waiting.
 *
 * A photo sent in through the form goes into photos/queue/, which is private, and
 * stays there until a committee member accepts it. The upload cannot ask anybody
 * to look, so this is what does: one plain-text email per submission, with a link
 * to the review page.
 *
 * Three things decide whether a message goes out, and all of them are here rather
 * than in upload.php:
 *
 *   - the recipient, from ~/suas-config.php, so the address can change without a
 *     deploy;
 *   - a rolling hourly cap, because upload.php is public and an endpoint that
 *     mails on every POST is a way to fill somebody's inbox from a script;
 *   - the refusal list below, which is not configurable.
 *
 * Nothing here may throw. The photos are stored, and the submitter has already
 * been told it worked, by the time this runs: a mail server having a bad day must
 * not turn a good upload into an error. Every attempt -- sent, skipped or failed
 * -- is appended to mail.log in the data directory, which is where a notification
 * that never arrived is found.
 *
 * mail() is used rather than an API, because the host runs its own MTA: no
 * account, no key, nothing to install. The trade is deliverability, which is why
 * the log exists and why the message is checked on the live site rather than
 * assumed to have arrived.
 */

/**
 * Addresses this site must never mail.
 *
 * The club's published Gmail is read by hand and must not receive this
 * notification, so the address is refused here rather than merely left out of
 * the config: the recipient is configurable, and a plausible-looking edit to
 * ~/suas-config.php is all it would take to start sending there.
 */
function suas_notify_refused(string $email): bool
{
    static $refused = ['usydastronomy@gmail.com'];
    return in_array(strtolower(trim($email)), $refused, true);
}

/** Where submissions are announced. The default is set in includes/bootstrap.php. */
function suas_notify_recipient(): string
{
    return trim((string) config('notify_email'));
}

/** The address the notification comes from: a mailbox on our own domain, so it aligns. */
function suas_notify_from(): string
{
    $from = trim((string) config('notify_from'));
    return $from !== '' ? $from : 'photos@usydastro.org';
}

/** The review page as a whole URL, for the link in the message. */
function suas_review_url(): string
{
    return rtrim((string) config('site_url'), '/') . '/admin.php';
}

/**
 * Strip anything that has no business in a message.
 *
 * Control characters, and newlines in particular: the submitter's name reaches
 * the subject line, and a name containing CRLF is how a header gets a second one
 * added to it.
 */
function suas_notify_clean(string $value): string
{
    return trim((string) preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value));
}

/**
 * The message a submission produces, as data rather than as a send.
 *
 * Separated from sending deliberately: a development machine has no MTA, so this
 * is the half that can be checked without one, and it is where the recipient
 * guard, the subject and every header live. Null means "there is nothing to send
 * to", which the caller logs.
 *
 * @return array{to:string, subject:string, body:string, headers:string[]}|null
 */
function suas_notify_message(array $submission, int $pending): ?array
{
    $recipient = suas_notify_recipient();
    if (suas_notify_refused($recipient)) {
        return null;
    }
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
        return null;
    }

    $files = array_values(array_filter(array_map(
        'strval',
        (array) ($submission['files'] ?? [])
    )));
    $count = count($files);
    $name = suas_notify_clean((string) ($submission['name'] ?? ''));
    $email = suas_notify_clean((string) ($submission['email'] ?? ''));
    $caption = suas_notify_clean((string) ($submission['caption'] ?? ''));
    $from = suas_notify_from();
    $link = suas_review_url();

    $subject = sprintf(
        '[SUAS photos] %d new %s to review%s',
        $count,
        $count === 1 ? 'photo' : 'photos',
        $name !== '' ? ' from ' . $name : ''
    );

    $lines = [
        sprintf(
            '%s sent %d %s in for review.',
            $name !== '' ? $name : 'Somebody',
            $count,
            $count === 1 ? 'photo' : 'photos'
        ),
        '',
    ];
    if ($name !== '') {
        $lines[] = '  Name:    ' . $name;
    }
    if ($email !== '') {
        $lines[] = '  Email:   ' . $email;
    }
    if ($caption !== '') {
        $lines[] = '  Details: ' . $caption;
    }
    if ($files !== []) {
        $lines[] = '  Files:   ' . implode(', ', $files);
    }
    $lines[] = '';
    $lines[] = sprintf(
        '%d %s waiting for review.',
        $pending,
        $pending === 1 ? 'photo is' : 'photos are'
    );
    $lines[] = '';
    $lines[] = 'Accept or reject them here:';
    $lines[] = $link;
    $lines[] = '';
    $lines[] = 'This address can be changed in ~/suas-config.php.';

    $headers = [
        'From: SUAS website <' . $from . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
    ];
    /* Only when it is an address we would mail: a Reply-To has to be a header
       value too, and the submitter's own address is the one thing here that
       arrives from outside. */
    if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $headers[] = 'Reply-To: ' . $email;
    }

    return [
        'to' => $recipient,
        'subject' => $subject,
        'body' => implode("\n", $lines),
        'headers' => $headers,
    ];
}

/** Hand a built message to the host's MTA, keeping the envelope sender on our domain. */
function suas_mail_send(array $message): bool
{
    $from = suas_notify_from();
    $params = filter_var($from, FILTER_VALIDATE_EMAIL) ? '-f' . $from : '';
    return @mail(
        $message['to'],
        $message['subject'],
        $message['body'],
        implode("\r\n", $message['headers']),
        $params
    );
}

/** How many notifications have actually gone out in the last $seconds. */
function suas_notify_sent_since(int $seconds): int
{
    $path = data_dir() . '/mail.log';
    if (!is_readable($path)) {
        return 0;
    }
    $cutoff = time() - $seconds;
    $sent = 0;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $record = json_decode($line, true);
        if (!is_array($record) || ($record['outcome'] ?? '') !== 'sent') {
            continue;
        }
        if ((int) strtotime((string) ($record['at'] ?? '')) >= $cutoff) {
            $sent++;
        }
    }
    return $sent;
}

/**
 * Announce one submission, and never fail the upload that produced it.
 *
 * The boolean is for the caller's own logging; upload.php ignores it on purpose,
 * because there is nothing useful it could do with a no.
 */
function suas_notify_submission(array $submission, int $pending): bool
{
    try {
        $cap = (int) config('notify_max_per_hour');
        if ($cap > 0 && suas_notify_sent_since(3600) >= $cap) {
            photo_append_log('mail.log', [
                'at' => date('c'),
                'outcome' => 'skipped',
                'detail' => sprintf('hourly cap of %d notifications reached', $cap),
            ]);
            return false;
        }

        $message = suas_notify_message($submission, $pending);
        if ($message === null) {
            photo_append_log('mail.log', [
                'at' => date('c'),
                'outcome' => 'skipped',
                'detail' => suas_notify_refused(suas_notify_recipient())
                    ? 'the configured recipient is one this site must not mail'
                    : 'no usable notification address is configured',
            ]);
            return false;
        }

        $ok = suas_mail_send($message);
        photo_append_log('mail.log', [
            'at' => date('c'),
            'outcome' => $ok ? 'sent' : 'failed',
            'to' => $message['to'],
            'subject' => $message['subject'],
            'pending' => $pending,
            'detail' => $ok ? 'handed to the local MTA' : 'mail() refused the message',
        ]);
        return $ok;
    } catch (Throwable $error) {
        /* Including the logging itself having failed: this is the last thing
           between a stored submission and a 500 for the submitter. */
        try {
            photo_append_log('mail.log', [
                'at' => date('c'),
                'outcome' => 'failed',
                'detail' => 'exception: ' . $error->getMessage(),
            ]);
        } catch (Throwable $ignored) {
        }
        return false;
    }
}
