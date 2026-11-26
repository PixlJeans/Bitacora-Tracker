<?php
// ===== Bitácora Tracker · server for the web version =====
// A single PHP file (7.4+), no database: everything is stored in files inside a private folder
// with a random name («datos-xxxxxxxx», created on first use and protected with .htaccess).
//   · usuarios.json   users with hashed passwords (password_hash)
//   · datos.json      the app data (same format as the desktop app) + version.txt
//   · proyectos/<code>/   photos, PDFs and reports
//   · respaldos/      one backup per day (the 30 most recent are kept)
//   · papelera/       deleted files
// The on-disk names above are kept from earlier versions so existing installs keep working.
// Every call is a JSON POST, except GET ?a=file&path=… which serves a file.

declare(strict_types=1);
error_reporting(E_ALL);
ini_set('display_errors', '0');

const MAX_UPLOAD = 40 * 1024 * 1024; // 40 MB per file (before base64)

// ---------- private folder ----------
$cfg = __DIR__ . '/config.php';
if (!is_file($cfg)) {
  $name = 'datos-' . bin2hex(random_bytes(8));
  if (@file_put_contents($cfg, "<?php return " . var_export(['folder' => $name], true) . ";\n") === false)
    fail(500, 'No se puede escribir en la carpeta de la app. Dale permiso de escritura (755/775) a la carpeta bitacora-tracker.');
}
$CONF = require $cfg;
$BASE = __DIR__ . '/' . ($CONF['folder'] ?? $CONF['carpeta']); // «carpeta»: config written by v1.5 and earlier
foreach (['', '/proyectos', '/respaldos', '/papelera', '/intentos'] as $sub) if (!is_dir($BASE . $sub)) @mkdir($BASE . $sub, 0775, true);
if (!is_file("$BASE/.htaccess")) {
  @file_put_contents("$BASE/.htaccess", "Require all denied\nDeny from all\n");
  @file_put_contents("$BASE/index.html", '');
}

// ---------- session ----------
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$cookiePath = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
session_name('bt_sesion');
session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 30, 'path' => $cookiePath, 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
session_start();

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// ---------- helpers ----------
function fail(int $code, string $msg, array $extra = []): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['error' => $msg] + $extra, JSON_UNESCAPED_UNICODE);
  exit;
}
function ok(array $r = []): void {
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => true] + $r, JSON_UNESCAPED_UNICODE);
  exit;
}
function readJson(string $f, $default) { if (!is_file($f)) return $default; $v = json_decode((string)file_get_contents($f), true); return $v === null ? $default : $v; }
function writeFile(string $f, string $txt): void {
  $tmp = $f . '.tmp' . bin2hex(random_bytes(3));
  if (file_put_contents($tmp, $txt, LOCK_EX) === false || !rename($tmp, $f)) { @unlink($tmp); fail(500, 'No se pudo escribir en el servidor (¿disco lleno o sin permisos?).'); }
}
/** User records: {user, name, hash, admin, created}. Records saved by v1.5 used Spanish keys. */
function users(): array {
  global $BASE;
  return array_map(fn($u) => [
    'user' => $u['user'] ?? $u['usuario'] ?? '', 'name' => $u['name'] ?? $u['nombre'] ?? '', 'hash' => $u['hash'] ?? '',
    'admin' => !empty($u['admin']), 'created' => $u['created'] ?? $u['creado'] ?? ''
  ], readJson("$BASE/usuarios.json", []));
}
function saveUsers(array $u): void { global $BASE; writeFile("$BASE/usuarios.json", json_encode(array_values($u), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); }
function me(): ?array {
  $id = $_SESSION['u'] ?? null; if (!$id) return null;
  foreach (users() as $u) if ($u['user'] === $id) return $u;
  return null;
}
function publicUser(array $u): array { return ['user' => $u['user'], 'name' => $u['name'], 'admin' => !empty($u['admin'])]; }
function requireLogin(): array { $u = me(); if (!$u) fail(401, 'Tu sesión terminó. Vuelve a iniciar sesión.'); return $u; }
function safeName(string $s): string {
  $s = preg_replace('/[\\\\\/:*?"<>|\x00-\x1f]+/u', '_', $s) ?? '';
  $s = trim(preg_replace('/\.{2,}/', '.', $s) ?? '', ". \t");
  return $s === '' ? 'archivo' : mb_substr($s, 0, 120);
}
/** Relative path «proyectos/…» → absolute path inside the private folder (rejects ../). */
function insidePath(string $rel): string {
  global $BASE;
  $rel = str_replace('\\', '/', $rel);
  if ($rel === '' || $rel[0] === '/' || strpos($rel, '..') !== false || strpos($rel, 'proyectos/') !== 0) fail(400, 'Ruta no válida');
  return "$BASE/$rel";
}
function dataVersion(): int { global $BASE; return (int)@file_get_contents("$BASE/version.txt"); }
function clientIp(): string { return preg_replace('/[^0-9a-f.:]/i', '', $_SERVER['REMOTE_ADDR'] ?? 'x') ?: 'x'; }
function validUser(string $user): void { if (!preg_match('/^[a-z0-9._@-]{3,60}$/', $user)) fail(400, 'Usuario: de 3 a 60 letras, números, punto, guion o @ (sin espacios).'); }
function validPassword(string $pw, string $msg = 'La contraseña debe tener al menos 8 caracteres.'): void { if (strlen($pw) < 8) fail(400, $msg); }

// ---------- file download (GET) ----------
if (($_GET['a'] ?? '') === 'file') {
  requireLogin();
  $f = insidePath((string)($_GET['path'] ?? ''));
  if (!is_file($f)) fail(404, 'El archivo ya no está');
  $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
  $types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif', 'heic' => 'image/heic', 'pdf' => 'application/pdf', 'txt' => 'text/plain; charset=utf-8'];
  header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
  header('Content-Length: ' . filesize($f));
  header('Cache-Control: private, max-age=86400');
  $download = isset($_GET['download']) || !isset($types[$ext]);
  header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . rawurlencode(basename($f)) . '"');
  header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf");
  readfile($f);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'Usa POST');
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) fail(415, 'Se espera JSON'); // also blocks form-based CSRF
$body = file_get_contents('php://input');
$in = json_decode((string)$body, true);
if (!is_array($in)) fail(400, 'Petición ilegible' . (strlen((string)$body) === 0 ? ' (¿archivo demasiado grande para el servidor?)' : ''));
$a = (string)($in['a'] ?? '');

switch ($a) {
  // ----- sign-in -----
  case 'status':
    $u = me();
    ok(['hasUsers' => count(users()) > 0, 'user' => $u ? publicUser($u) : null]);

  case 'createFirst': {
    if (count(users()) > 0) fail(403, 'Ya existe una cuenta. Inicia sesión.');
    $user = strtolower(trim((string)($in['user'] ?? '')));
    $name = trim((string)($in['name'] ?? '')) ?: $user;
    $password = (string)($in['password'] ?? '');
    validUser($user); validPassword($password);
    saveUsers([['user' => $user, 'name' => $name, 'hash' => password_hash($password, PASSWORD_DEFAULT), 'admin' => true, 'created' => date('c')]]);
    session_regenerate_id(true); $_SESSION['u'] = $user;
    ok(['user' => publicUser(me())]);
  }

  case 'login': {
    $f = "$BASE/intentos/" . md5(clientIp()) . '.json';
    $tries = readJson($f, ['n' => 0, 't' => 0]);
    if ($tries['n'] >= 5 && time() - $tries['t'] < 300) fail(429, 'Demasiados intentos. Espera 5 minutos.');
    $user = strtolower(trim((string)($in['user'] ?? '')));
    $password = (string)($in['password'] ?? '');
    foreach (users() as $u) {
      if ($u['user'] === $user && password_verify($password, $u['hash'])) {
        @unlink($f);
        session_regenerate_id(true); $_SESSION['u'] = $user;
        ok(['user' => publicUser($u)]);
      }
    }
    usleep(600000);
    $tries = ['n' => ($tries['n'] >= 5 ? 0 : $tries['n']) + 1, 't' => time()];
    @file_put_contents($f, json_encode($tries));
    fail(401, 'Usuario o contraseña incorrectos.');
  }

  case 'logout':
    $_SESSION = []; session_destroy();
    ok();

  // ----- users -----
  case 'users': {
    $u = requireLogin();
    ok(['users' => array_map('publicUser', users()), 'me' => publicUser($u)]);
  }
  case 'userCreate': {
    $u = requireLogin(); if (empty($u['admin'])) fail(403, 'Solo un administrador puede agregar usuarios.');
    $user = strtolower(trim((string)($in['user'] ?? '')));
    $password = (string)($in['password'] ?? '');
    validUser($user); validPassword($password);
    $list = users();
    foreach ($list as $x) if ($x['user'] === $user) fail(400, 'Ese usuario ya existe.');
    $list[] = ['user' => $user, 'name' => trim((string)($in['name'] ?? '')) ?: $user, 'hash' => password_hash($password, PASSWORD_DEFAULT), 'admin' => !empty($in['admin']), 'created' => date('c')];
    saveUsers($list);
    ok(['users' => array_map('publicUser', $list)]);
  }
  case 'userDelete': {
    $u = requireLogin(); if (empty($u['admin'])) fail(403, 'Solo un administrador puede quitar usuarios.');
    $who = (string)($in['user'] ?? '');
    if ($who === $u['user']) fail(400, 'No puedes quitarte a ti mismo.');
    $list = array_values(array_filter(users(), fn($x) => $x['user'] !== $who));
    saveUsers($list);
    ok(['users' => array_map('publicUser', $list)]);
  }
  case 'changePassword': {
    $u = requireLogin();
    $next = (string)($in['next'] ?? '');
    if (!password_verify((string)($in['current'] ?? ''), $u['hash'])) fail(400, 'La contraseña actual no es correcta.');
    validPassword($next, 'La nueva contraseña debe tener al menos 8 caracteres.');
    $list = users();
    foreach ($list as &$x) if ($x['user'] === $u['user']) $x['hash'] = password_hash($next, PASSWORD_DEFAULT);
    unset($x);
    saveUsers($list);
    ok();
  }

  // ----- app data -----
  case 'load':
    requireLogin();
    ok(['json' => is_file("$BASE/datos.json") ? file_get_contents("$BASE/datos.json") : null, 'version' => dataVersion()]);

  case 'version':
    requireLogin();
    ok(['version' => dataVersion()]);

  case 'save': {
    $u = requireLogin();
    $json = (string)($in['json'] ?? '');
    if (json_decode($json) === null) fail(400, 'Datos ilegibles');
    $lock = fopen("$BASE/version.txt.lock", 'c'); flock($lock, LOCK_EX);
    $v = dataVersion();
    if (isset($in['version']) && (int)$in['version'] !== $v && empty($in['force'])) { flock($lock, LOCK_UN); fail(409, 'Otra persona guardó cambios mientras editabas.', ['version' => $v]); }
    if (is_file("$BASE/datos.json")) @copy("$BASE/datos.json", "$BASE/datos.json.bak");
    writeFile("$BASE/datos.json", $json);
    writeFile("$BASE/version.txt", (string)($v + 1));
    @file_put_contents("$BASE/ultimo.txt", $u['user'] . ' ' . date('c'));
    flock($lock, LOCK_UN);
    // daily backup
    $today = "$BASE/respaldos/auto-" . date('Y-m-d') . '.json';
    if (!is_file($today)) {
      @copy("$BASE/datos.json", $today);
      $all = glob("$BASE/respaldos/auto-*.json") ?: []; sort($all);
      foreach (array_slice($all, 0, max(0, count($all) - 30)) as $old) @unlink($old);
    }
    ok(['version' => $v + 1]);
  }

  case 'backup': {
    requireLogin();
    $n = safeName((string)($in['name'] ?? 'respaldo.json'));
    writeFile("$BASE/respaldos/$n", (string)($in['content'] ?? ''));
    ok(['path' => "respaldos/$n"]);
  }

  // ----- project files -----
  case 'upload': {
    requireLogin();
    $code = safeName((string)($in['code'] ?? ''));
    $data = base64_decode((string)($in['data'] ?? ''), true);
    if ($data === false) fail(400, 'Archivo ilegible');
    if (strlen($data) > MAX_UPLOAD) fail(413, 'El archivo pasa de 40 MB.');
    $dir = "$BASE/proyectos/$code";
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $name = safeName((string)($in['name'] ?? 'archivo'));
    $ext = pathinfo($name, PATHINFO_EXTENSION);
    if (preg_match('/^(php\d?|phtml|phar|htaccess|cgi|pl|py|sh|exe|js|html?)$/i', $ext)) $name .= '.txt'; // never executable
    $stem = pathinfo($name, PATHINFO_FILENAME); $ext = pathinfo($name, PATHINFO_EXTENSION);
    $final = $name; $k = 1;
    while (file_exists("$dir/$final")) { $final = $stem . " ($k)" . ($ext !== '' ? ".$ext" : ''); $k++; }
    writeFile("$dir/$final", $data);
    $thumb = null;
    if (!empty($in['thumb'])) {
      $t = base64_decode((string)$in['thumb'], true);
      if ($t !== false) { writeFile("$dir/$final.mini.jpg", $t); $thumb = "proyectos/$code/$final.mini.jpg"; }
    }
    ok(['path' => "proyectos/$code/$final", 'thumb' => $thumb]);
  }

  case 'delete': {
    requireLogin();
    $f = insidePath((string)($in['path'] ?? ''));
    if (is_file($f)) @rename($f, "$BASE/papelera/" . date('Ymd-His') . '_' . basename($f));
    ok();
  }

  default:
    fail(400, 'Acción desconocida');
}
