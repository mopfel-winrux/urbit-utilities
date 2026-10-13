// Launcher for EmulatorJS on Urbit: pick a system and a local ROM, then boot
// EmulatorJS from the vendored data/ folder. No network requests leave the ship.
(function () {
  // EJS system id, label, extensions used to guess it. Every core listed here
  // is vendored in data/cores (see build.sh CORES).
  var SYSTEMS = [
    ['nes', 'Nintendo NES / Famicom (FCEUmm)', ['nes', 'fds', 'unf', 'unif']],
    ['snes', 'Super Nintendo (Snes9x)', ['smc', 'sfc', 'swc', 'fig', 'bs']],
    ['gb', 'Game Boy / Game Boy Color (Gambatte)', ['gb', 'gbc', 'dmg']],
    ['gba', 'Game Boy Advance (mGBA)', ['gba']],
    ['n64', 'Nintendo 64 (Mupen64Plus-Next)', ['n64', 'z64', 'v64']],
    ['nds', 'Nintendo DS (melonDS)', ['nds']],
    ['vb', 'Virtual Boy (Beetle VB)', ['vb', 'vboy']],
    ['segaMD', 'Sega Genesis / Mega Drive (Genesis Plus GX)', ['md', 'gen', 'smd', 'mdx']],
    ['segaMS', 'Sega Master System (Genesis Plus GX)', ['sms']],
    ['segaGG', 'Sega Game Gear (Genesis Plus GX)', ['gg']],
    ['sega32x', 'Sega 32X (PicoDrive)', ['32x']],
    ['psx', 'PlayStation (PCSX ReARMed)', ['cue', 'pbp', 'chd', 'img', 'iso']],
    ['pce', 'PC Engine / TurboGrafx-16 (Beetle PCE)', ['pce']],
    ['ngp', 'Neo Geo Pocket / Color (Beetle NGP)', ['ngp', 'ngc']],
    ['ws', 'WonderSwan / Color (Beetle WonderSwan)', ['ws', 'wsc']],
    ['atari2600', 'Atari 2600 (Stella 2014)', ['a26']],
    ['atari7800', 'Atari 7800 (ProSystem)', ['a78']],
    ['c64', 'Commodore 64 (VICE x64sc)', ['d64', 't64', 'prg', 'crt', 'tap', 'g64']],
    ['arcade', 'Arcade (FinalBurn Neo, ROM set .zip)', []]
  ];
  // localization files shipped in data/localization (en-US is built in)
  var LANGS = ['af-FR', 'ar-AR', 'ben-BEN', 'de-GER', 'el-GR', 'es-ES', 'fa-AF', 'hi-HI', 'it-IT', 'ja-JA',
    'jv-JV', 'ko-KO', 'pt-BR', 'ro-RO', 'ru-RU', 'tr-TR', 'vi-VN', 'zh-CN'];

  var $ = function (id) { return document.getElementById(id); };
  var sel = $('system'), rom = $('rom'), start = $('start'), err = $('err');
  SYSTEMS.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s[0]; o.textContent = s[1];
    sel.appendChild(o);
  });
  try { var last = localStorage.getItem('ejs-launcher-system'); if (last) sel.value = last; } catch (e) {}

  function guess(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    for (var i = 0; i < SYSTEMS.length; i++) if (SYSTEMS[i][2].indexOf(ext) >= 0) return SYSTEMS[i][0];
    return null;
  }
  rom.addEventListener('change', function () {
    var f = rom.files[0];
    err.textContent = '';
    start.disabled = !f;
    if (!f) return;
    var g = guess(f.name);
    if (g) sel.value = g;
    else if (!/\.(zip|7z|bin)$/i.test(f.name)) err.textContent = 'Unknown extension: check the system below.';
  });

  function pickLanguage() {
    var want = (navigator.language || 'en-US');
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].toLowerCase() === want.toLowerCase()) return LANGS[i];
    }
    var pre = want.split('-')[0].toLowerCase();
    for (var j = 0; j < LANGS.length; j++) {
      if (LANGS[j].split('-')[0].toLowerCase() === pre) return LANGS[j];
    }
    return 'en-US';
  }

  start.addEventListener('click', function () {
    var f = rom.files[0];
    if (!f) return;
    try { localStorage.setItem('ejs-launcher-system', sel.value); } catch (e) {}
    $('title').textContent = sel.options[sel.selectedIndex].textContent + ' — ' + f.name;
    document.body.classList.add('playing');
    window.EJS_player = '#game';
    window.EJS_core = sel.value;
    window.EJS_gameUrl = f;
    window.EJS_gameName = f.name.replace(/\.[^.]+$/, '');
    window.EJS_pathtodata = new URL('data/', location.href).pathname;
    window.EJS_startOnLoaded = true;
    window.EJS_threads = false;
    window.EJS_language = pickLanguage();
    window.EJS_disableAutoLang = false; // (sic) false means "don't auto-detect"
    var s = document.createElement('script');
    s.src = 'data/loader.js';
    document.body.appendChild(s);
  });
  $('back').addEventListener('click', function () { location.reload(); });
})();
