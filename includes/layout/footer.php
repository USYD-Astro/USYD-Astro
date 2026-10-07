<?php
declare(strict_types=1);

/**
 * Closes the layout opened by layout/header.php: the site footer, then the
 * page's scripts. Add per-page files to $page_scripts before including this.
 */

$page_scripts = $page_scripts ?? [];
?>
</main>

<footer class="site-foot">
  <div class="site-foot__inner">
    <div class="site-foot__block">
      <h3>Get involved</h3>
      <p>Join the society via <a href="https://usu.edu.au/clubs/suas">the USU club page</a></p>
    </div>
    <div class="site-foot__block">
      <h3>Contact</h3>
      <ul class="socials">
        <li><a href="https://www.facebook.com/usydastronomy/" aria-label="Facebook"><img src="assets/img/social/facebook-white.png" alt="Facebook"></a></li>
        <li><a href="https://instagram.com/usydastro/" aria-label="Instagram"><img src="assets/img/social/instagram-white.png" alt="Instagram"></a></li>
        <li><a href="https://discord.gg/nGVW4qJMSV" aria-label="Discord"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg></a></li>
        <li><a href="mailto:usydastronomy@gmail.com" aria-label="Email"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg></a></li>
      </ul>
    </div>
    <div class="usu">
      <img src="assets/img/usu-supported-by.png" alt="Supported by the University of Sydney Union">
    </div>
  </div>
  <p class="site-foot__legal">&copy; 2026 Sydney University Astronomy Society | Website by Murray Jones</p>
</footer>

<script src="assets/js/main.js"></script>
<?php foreach ($page_scripts as $script): ?>
<script src="<?= e($script) ?>"></script>
<?php endforeach; ?>
</body>
</html>
