<?php
declare(strict_types=1);

/**
 * The original Google Site served its home page at both / and /home, and this
 * alias keeps the old /home URL working for anyone who kept the link.
 *
 * The static version answered with a meta-refresh. Now that a script is doing
 * the answering, a real 301 is both honest and faster, and the alias costs one
 * small file to keep.
 */

require __DIR__ . '/includes/bootstrap.php';

header('Location: index.php', true, 301);
?>
<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>SUAS</title>
<link rel="canonical" href="index.php">
<meta http-equiv="refresh" content="0; url=index.php">
<meta name="robots" content="noindex">
</head>
<body>
<p>Redirecting to the <a href="index.php">home page</a>&hellip;</p>
</body>
</html>
