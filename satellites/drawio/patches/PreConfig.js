/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 *
 * urbit satellite: fully offline, self-contained draw.io served from /drawio/.
 * Replaces js/PreConfig.js; runs after bootstrap.js parses urlParams and
 * before app.min.js (diagramly/Init.js), so these act like URL parameters.
 */
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null; // no export server: PDF export uses the print dialog
window.DRAWIO_BASE_URL = null;
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null;
window.NOTIFICATIONS_URL = null;
window.DRAWIO_LOG_URL = '';
urlParams['sync'] = 'manual';
// offline=1 turns off Google Drive, OneDrive, Dropbox, GitHub, GitLab, Trello
// and M365, plugins, Pusher realtime, notifications and logging. lockdown=1
// additionally disables the realtime cache and any other draw.io servers.
urlParams['offline'] = '1';
urlParams['lockdown'] = '1';
urlParams['plugins'] = '0';
urlParams['gapi'] = '0';
urlParams['picker'] = '0';
urlParams['db'] = '0';
urlParams['od'] = '0';
urlParams['gh'] = '0';
urlParams['gl'] = '0';
urlParams['tr'] = '0';
urlParams['ms365'] = '0';
// save/open on this device (browser downloads and file picker)
urlParams['mode'] = urlParams['mode'] || 'device';
// install draw.io's own precache service worker on the first load (it is
// scoped to /drawio/ and rejects HTML bodies for non-HTML entries)
urlParams['enableSW'] = '1';
