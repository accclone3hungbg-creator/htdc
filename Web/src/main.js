import { LibMedia } from "../libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "../libmidi/libmidi.js";
import { codeMap, KeyRepeatManager } from "./key.js";
import { EventQueue } from "./eventqueue.js";
import { initKbdListeners, setKbdHandler, kbdWidth, kbdHeight } from "./screenKbd.js";
import { initTextInput } from "./vkbd.js";

// we need to import natives here, don't use System.loadLibrary
// since CheerpJ fails to load them in firefox and we can't set breakpoints
import canvasFontNatives from "../libjs/libcanvasfont.js";
import canvasGraphicsNatives from "../libjs/libcanvasgraphics.js";
import gles2Natives from "../libjs/libgles2.js";
import jsReferenceNatives from "../libjs/libjsreference.js";
import mediaBridgeNatives from "../libjs/libmediabridge.js";
import midiBridgeNatives from "../libjs/libmidibridge.js";

const evtQueue = new EventQueue();
const sp = new URLSearchParams(location.search);

// ---- Cai dat (luu trong may, doi bang nut ⚙; link ?mode= ?res= ?short= ?fps= van ghi de duoc) ----
// Goi y: may yeu / iPhone -> mode fast. Resolution cang thap + fps co gioi han = cang muot.
// budget = so pixel toi da cua khung hinh game (giu dung ti le man hinh, chi giam do phan giai)
const PRESETS = {
    fast:  { budget: 46000,  fps: 30, quality: 0, label: 'Nhanh (may yeu/iPhone)' },
    bal:   { budget: 85000,  fps: 30, quality: 0, label: 'Can bang' },
    sharp: { budget: 260000, fps: 0,  quality: 2, label: 'Net (nang)' },
};
const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouch = isiOS || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// null = theo preset
const cfg = { mode: isiOS ? 'fast' : 'bal', auto: true, short: null, debug: false, fps: null, quality: null, clamp: null };
try {
    const saved = JSON.parse(localStorage.getItem('hthCfg') || '{}');
    if (typeof saved.auto === 'boolean') cfg.auto = saved.auto;
    if (typeof saved.mode === 'string' && PRESETS[saved.mode]) cfg.mode = saved.mode;
    if (saved.short) cfg.short = saved.short;
    if (typeof saved.fps === 'number') cfg.fps = saved.fps;
    if (typeof saved.quality === 'number') cfg.quality = saved.quality;
    if (typeof saved.clamp === 'number') cfg.clamp = saved.clamp;
    if (typeof saved.debug === 'boolean') cfg.debug = saved.debug;
} catch (e) {}
const P = () => PRESETS[cfg.mode] || PRESETS.bal;
const eff = {
    short: () => cfg.short,
    budget: () => P().budget,
    fps: () => cfg.fps ?? P().fps,
    quality: () => cfg.quality ?? P().quality,
};
if (sp.get('mode') && PRESETS[sp.get('mode')]) cfg.mode = sp.get('mode');
if (sp.get('res') === 'auto') cfg.auto = true; else if (sp.get('res') === '0') cfg.auto = false;
if (sp.get('short')) cfg.short = parseInt(sp.get('short')) || null;
if (sp.get('debug') === '1') cfg.debug = true;
if (sp.get('fps')) cfg.fps = parseInt(sp.get('fps')) || 0;
if (sp.get('quality')) cfg.quality = Math.max(0, Math.min(2, parseInt(sp.get('quality')) || 0));

function reloadPage() {
    localStorage.setItem('hthCfg', JSON.stringify(cfg));
    location.href = location.pathname + '?jar=' + (sp.get('jar') || 'game.jar');
}
window.hthCfg = {
    get auto() { return cfg.auto; },
    get short() { return eff.short(); },
    get debug() { return cfg.debug; },
    get fps() { return eff.fps(); },
    get quality() { return eff.quality(); },
    get mode() { return cfg.mode; },
    get modeLabel() { return P().label; },
    get custom() { return cfg.short !== null || cfg.fps !== null || cfg.quality !== null || cfg.clamp !== null; },
    // doi do phan giai can nap lai trang de co hieu luc
    set(k, v, reload) {
        if (k === 'mode') {
            cfg.mode = PRESETS[v] ? v : cfg.mode;
            cfg.short = null; cfg.fps = null; cfg.quality = null; cfg.clamp = null;
        } else {
            cfg[k] = v;
        }
        try { localStorage.setItem('hthCfg', JSON.stringify(cfg)); } catch (e) {}
        if (reload) location.href = location.pathname + '?jar=' + (sp.get('jar') || 'game.jar');
    },
    nextMode() {
        const order = ['fast', 'bal', 'sharp'];
        return order[(order.indexOf(cfg.mode) + 1) % order.length];
    },
};

const cheerpjWebRoot = '/app'+location.pathname.replace(/\/[^/]*$/,'');

let isMobile = sp.get('mobile');
if (isMobile === null) {
    let padPref = null;
    try { padPref = localStorage.getItem('hthPad'); } catch (e) {}
    isMobile = (padPref !== null ? padPref === '1' : isTouch) ? 1 : null;
}

let display = null;      // canvas HIEN THI (do phan giai that cua man hinh -> net)
let gameCanvas = null;   // canvas cua game (offscreen, Java ve vao day)
let screenCtx = null;
let viewCtx = null;
let scaleSet = false;

const keyRepeatManager = new KeyRepeatManager();

window.evtQueue = evtQueue;

// ---------------- cai dat hien thi ----------------
const view = {
    fill: cfg.auto,   // true: tran vien (keo gian kin man hinh) | false: giu ti le, co vien den
    smooth: true,  // true: nen "sharp bilinear" (net + muot) | false: pixel vuong
};
try {
    const sf = localStorage.getItem('hthFill5');
    if (sf === '1') view.fill = true; else if (sf === '0') view.fill = false;
    if (localStorage.getItem('hthSmooth') === '0') view.smooth = false;
} catch (e) {}

window.hthView = {
    get fill() { return view.fill; },
    get smooth() { return view.smooth; },
    setFill(v) {
        view.fill = !!v;
        try { localStorage.setItem('hthFill5', view.fill ? '1' : '0'); } catch (e) {}
        autoscale();
    },
    setSmooth(v) {
        view.smooth = !!v; dirty = true; applyCssRendering();
        try { localStorage.setItem('hthSmooth', view.smooth ? '1' : '0'); } catch (e) {}
    },
};

// canvas trung gian: phong to nguyen (nearest) len boi so nguyen, roi thu nho mem ve dung kich thuoc
// -> pixel art giu duoc net ma khong bi vo/rang cua o ti le le
let preCanvas = null, preCtx = null;

let dirty = true, lastDraw = 0;
function applyCssRendering() {
    if (!display) return;
    // che do Nhe/Can bang: GPU phong to canvas bang CSS -> khong ton CPU
    display.style.imageRendering = (eff.quality() < 2 && !view.smooth) ? 'pixelated' : 'auto';
}

function renderFrame() {
    requestAnimationFrame(renderFrame);
    const now = performance.now();
    if (!scaleSet || !viewCtx) return;
    if (now - lastDraw < 30) return;   // toi da ~33 khung/giay, du cho game J2ME
    lastDraw = now;

    const gw = gameCanvas.width, gh = gameCanvas.height;
    const vw = display.width, vh = display.height;
    if (!gw || !gh || !vw || !vh) return;

    // Nhe / Can bang: ve 1 lan (nearest) vao canvas da la boi so nguyen cua game, GPU lo phan con lai
    if (eff.quality() < 2) {
        viewCtx.imageSmoothingEnabled = false;
        viewCtx.drawImage(gameCanvas, 0, 0, vw, vh);
        return;
    }

    // Net (nang): sharp bilinear day du
    const sx = vw / gw, sy = vh / gh;
    const integer = Math.abs(sx - Math.round(sx)) < 0.001 && Math.abs(sy - Math.round(sy)) < 0.001;
    if (!view.smooth || integer || (sx < 1 && sy < 1)) {
        viewCtx.imageSmoothingEnabled = view.smooth;
        viewCtx.drawImage(gameCanvas, 0, 0, vw, vh);
        return;
    }
    const ix = Math.max(1, Math.min(Math.ceil(sx), 4));
    const iy = Math.max(1, Math.min(Math.ceil(sy), 4));
    if (!preCanvas) {
        preCanvas = document.createElement('canvas');
        preCtx = preCanvas.getContext('2d', { alpha: false });
    }
    if (preCanvas.width !== gw * ix || preCanvas.height !== gh * iy) {
        preCanvas.width = gw * ix;
        preCanvas.height = gh * iy;
    }
    preCtx.imageSmoothingEnabled = false;
    preCtx.drawImage(gameCanvas, 0, 0, preCanvas.width, preCanvas.height);
    viewCtx.imageSmoothingEnabled = true;
    viewCtx.drawImage(preCanvas, 0, 0, vw, vh);
}

function autoscale() {
    if (!scaleSet) return;

    if (isMobile) {
        document.getElementById('left-keys').style.display = '';
        document.getElementById('right-keys').style.display = '';
        if (window.innerWidth > window.innerHeight) {
            document.body.classList.add('kbd-landscape');
            document.body.classList.remove('kbd-portrait');
        } else {
            document.body.classList.add('kbd-portrait');
            document.body.classList.remove('kbd-landscape');
        }
    }

    const area = document.getElementById('screen-area');
    const aw = area.clientWidth, ah = area.clientHeight;
    const gw = gameCanvas.width, gh = gameCanvas.height;
    if (!aw || !ah || !gw || !gh) return;

    let cssW = aw, cssH = ah;
    if (!view.fill) {
        const k = Math.min(aw / gw, ah / gh);
        cssW = Math.round(gw * k);
        cssH = Math.round(gh * k);
    }

    const dpr = window.devicePixelRatio || 1;
    let pw, ph;
    const Q = eff.quality();
    if (Q >= 2) {
        pw = Math.max(1, Math.round(cssW * dpr));
        ph = Math.max(1, Math.round(cssH * dpr));
    } else if (Q === 0) {
        pw = gw; ph = gh;
    } else {
        const kx = Math.max(1, Math.min(4, Math.floor(cssW / gw * Math.min(dpr, 2))));
        const ky = Math.max(1, Math.min(4, Math.floor(cssH / gh * Math.min(dpr, 2))));
        pw = gw * kx; ph = gh * ky;
    }
    applyCssRendering();

    if (!viewCtx) viewCtx = display.getContext('2d', { alpha: false });

    display.style.width = cssW + 'px';
    display.style.height = cssH + 'px';
    if (display.width !== pw || display.height !== ph) {
        display.width = pw;
        display.height = ph;
        viewCtx = display.getContext('2d', { alpha: false });
    }
    dirty = true;
}

// vi tri cham (clientX/Y) -> toa do trong man hinh game
function toGameXY(e) {
    const r = display.getBoundingClientRect();
    const gw = gameCanvas.width, gh = gameCanvas.height;
    let x = Math.floor((e.clientX - r.left) / (r.width || 1) * gw);
    let y = Math.floor((e.clientY - r.top) / (r.height || 1) * gh);
    x = Math.max(0, Math.min(gw - 1, x));
    y = Math.max(0, Math.min(gh - 1, y));
    return { x, y };
}

function setListeners() {
    let mouseDown = false;
    let noMouse = false;

    setKbdHandler((isDown, key) => {
        const symbol = key.startsWith('Digit') ? key.substring(5) : '\x00';
        keyRepeatManager.post(isDown, key, {symbol, ctrlKey: false, shiftKey: false});
    });

    function handleKeyEvent(e) {
        const isDown = e.type === 'keydown';

        if (codeMap[e.code]) {
            keyRepeatManager.post(isDown, e.code, {
                symbol: e.key.length == 1 ? e.key.charCodeAt(0) : '\x00',
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey
            })
        }
        e.preventDefault();
    }

    display.addEventListener('keydown', handleKeyEvent);
    display.addEventListener('keyup', handleKeyEvent);

    keyRepeatManager.register((kind, key, args) => {
        if (kind === 'click') {
            if (key === 'Maximize') {
                window.hthView.setFill(!view.fill);
            }
        } else if (codeMap[key] || args.jcode !== undefined) {
            evtQueue.queueEvent({
                kind: kind === 'up' ? 'keyup' : 'keydown',
                args: [codeMap[key] !== undefined ? codeMap[key] : args.jcode, args.symbol, args.ctrlKey, args.shiftKey]
            });
        }
    });

    // Chuot + cam ung dung chung Pointer Events (iOS Safari 13+). Chi theo doi 1 ngon tay.
    let activePointer = null, downAt = 0;
    let dbgEl = null;
    function debugTap(kind, p) {
        if (!cfg.debug) { if (dbgEl) dbgEl.textContent = ''; return; }
        if (!dbgEl) {
            dbgEl = document.createElement('div');
            dbgEl.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:20;background:rgba(0,0,0,.7);color:#0f0;font:12px monospace;padding:4px 6px;pointer-events:none;';
            document.body.appendChild(dbgEl);
        }
        dbgEl.textContent = kind + ' game=' + gameCanvas.width + 'x' + gameCanvas.height + ' tap=' + p.x + ',' + p.y + ' view=' + display.style.width + 'x' + display.style.height;
    }

    display.addEventListener('pointerdown', e => {
        if (activePointer !== null) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        activePointer = e.pointerId;
        try { display.setPointerCapture(e.pointerId); } catch (err) {}
        if (!window.__kbdOpen) display.focus();

        const p = toGameXY(e);
        downAt = performance.now();
        debugTap('down', p);
        evtQueue.queueEvent({ kind: 'pointerpressed', x: p.x, y: p.y });
        e.preventDefault();
    });

    display.addEventListener('pointermove', e => {
        if (e.pointerId !== activePointer) return;
        const p = toGameXY(e);
        debugTap('drag', p);
        evtQueue.queueEvent({ kind: 'pointerdragged', x: p.x, y: p.y });
        e.preventDefault();
    });

    function endPointer(e) {
        if (e.pointerId !== activePointer) return;
        activePointer = null;
        const p = toGameXY(e);
        debugTap('up', p);
        // nhieu game doc trang thai cham theo vong lap -> giu nhan it nhat 80ms de khong bi bo lo
        const wait = Math.max(0, 80 - (performance.now() - downAt));
        setTimeout(() => evtQueue.queueEvent({ kind: 'pointerreleased', x: p.x, y: p.y }), wait);
        e.preventDefault();
    }
    display.addEventListener('pointerup', endPointer);
    display.addEventListener('pointercancel', endPointer);
    display.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousedown', e => {
        if (window.__kbdOpen) return;
        setTimeout(() => { if (!window.__kbdOpen) display.focus(); }, 20);
    });

    display.addEventListener('blur', e => {
        // it doesn't work without any timeout
        setTimeout(() => { if (!window.__kbdOpen) display.focus(); }, 10);
    });

    window.addEventListener('resize', autoscale);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', autoscale);
    if (window.ResizeObserver) new ResizeObserver(() => autoscale()).observe(document.getElementById('screen-area'));
    window.addEventListener('orientationchange', () => setTimeout(autoscale, 150));

    window.__padInitOn = !!isMobile;
    initKbdListeners();

    initTextInput({
        postKey: (isDown, key, args) => keyRepeatManager.post(isDown, key, args),
        setPad: on => {
            isMobile = on;
            try { localStorage.setItem('hthPad', on ? '1' : '0'); } catch (e) {}
            const l = document.getElementById('left-keys'), r = document.getElementById('right-keys');
            if (!on) {
                l.style.display = 'none'; r.style.display = 'none';
                document.body.classList.remove('kbd-portrait', 'kbd-landscape');
            }
            autoscale();
        }
    });
}

function setFaviconFromBuffer(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    const reader = new FileReader();
    reader.onload = function() {
        const dataURL = reader.result;

        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'icon');
            document.head.appendChild(link);
        }
        link.setAttribute('href', dataURL);
    };
    reader.readAsDataURL(blob);
}

async function ensureAppInstalled(lib, appId) {
    const appFile = await cjFileBlob(appId + "/app.jar");

    if (!appFile) {
        const launcherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;

        await launcherUtil.installFromBundle(cheerpjWebRoot + "/apps/", appId);
    }
}

// ---- Do phan giai game theo ti le man hinh (khong keo gian -> khong meo) ----
// vung hien thi that cua game (tru di bang phim ao neu dang bat)
function visibleArea() {
    let w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    if (isMobile) {
        if (w > h) w = Math.max(1, w - 440);   // 2 bang phim 2 ben
        else h = Math.max(1, h - 220);          // bang phim duoi
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
}

function computeGameSize() {
    const { w, h } = visibleArea();
    // A = ti le man hinh that -> ve dung ti le (khong meo), chi giam tong so pixel
    const A = Math.max(0.4, Math.min(2.5, w / h));
    if (eff.short()) {          // nguoi dung tu dat canh ngan (ghi de preset)
        const SHORT = Math.max(128, Math.min(720, eff.short()));
        let gw, gh;
        if (A >= 1) { gh = SHORT; gw = Math.round(SHORT * A); }
        else { gw = SHORT; gh = Math.round(SHORT / A); }
        return { gw: gw & ~1, gh: gh & ~1 };
    }
    const B = Math.max(20000, Math.min(600000, eff.budget()));
    window.__sizeDbg = { w, h, A, B, isMobile, short: eff.short(), mode: cfg.mode };
    const gw = Math.max(128, Math.round(Math.sqrt(B * A)) & ~1);
    const gh = Math.max(128, Math.round(Math.sqrt(B / A)) & ~1);
    return { gw, gh };
}
const orientKey = () => (window.innerWidth > window.innerHeight ? 'land' : 'port');
const startOrient = orientKey();

async function applyResolution(lib, jarPath) {
    try {
        const auto = cfg.auto;
        const { gw, gh } = auto ? computeGameSize() : { gw: 240, gh: 320 };
        const File = await lib.java.io.File;
        const MIDletLoader = await lib.org.recompile.mobile.MIDletLoader;
        const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
        const HashMap = await lib.java.util.HashMap;

        const loader = await MIDletLoader.getMIDletLoader(await new File(jarPath));
        let appId = await loader.getAppId();
        if (!appId) {
            await LauncherUtil.ensureAppId(loader, jarPath.split('/').pop());
            appId = await loader.getAppId();
        }
        if (!appId) return;

        const settings = await new HashMap();
        await settings.put('width', String(gw));
        await settings.put('height', String(gh));
        await settings.put('fps', String(eff.fps() | 0)); // 0 = khong gioi han
        await LauncherUtil.saveApp(appId, settings, null, null); // chi ghi de width/height
        console.log('[res] ' + gw + 'x' + gh + ' fps=' + (eff.fps()|0) + ' quality=' + eff.quality() + ' mode=' + cfg.mode + ' for ' + appId);
    } catch (e) {
        console.error('[res] khong dat duoc do phan giai, dung mac dinh', e);
    }
}

// xoay ngang/doc -> nap lai de game doi do phan giai
function watchOrientation() {
    let t = null;
    const check = () => {
        clearTimeout(t);
        t = setTimeout(() => { if (cfg.auto && orientKey() !== startOrient) location.reload(); }, 700);
    };
    window.addEventListener('orientationchange', check);
    window.addEventListener('resize', check);
}

async function init() {
    document.getElementById("loading").textContent = "Loading CheerpJ...";

    display = document.getElementById('display');
    gameCanvas = document.createElement('canvas');
    screenCtx = gameCanvas.getContext('2d');

    setListeners();

    window.libmidi = new LibMidi(createUnlockingAudioContext());
    await window.libmidi.init();
    window.libmidi.midiPlayer.addEventListener('end-of-media', e => {
        window.evtQueue.queueEvent({kind: 'player-eom', player: e.target});
    })
    window.libmedia = new LibMedia();

    await cheerpjInit({
        enableDebug: false,
        natives: {
            ...canvasFontNatives,
            ...canvasGraphicsNatives,
            ...gles2Natives,
            ...jsReferenceNatives,
            ...mediaBridgeNatives,
            ...midiBridgeNatives,
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setTitle(lib, title) {
                document.title = title;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setIcon(lib, iconBytes) {
                if (iconBytes) {
                    setFaviconFromBuffer(iconBytes.buffer);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_getScreenCtx(lib) {
                return screenCtx;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setCanvasSize(lib, width, height) {
                if (!scaleSet) {
                    document.getElementById('loading').hidden = true;
                    display.style.display = '';
                    scaleSet = true;
                    display.focus();
                    requestAnimationFrame(renderFrame);
                }
                screenCtx.canvas.width = width;
                screenCtx.canvas.height = height;
                autoscale();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener) {
                const KeyEvent = await lib.pl.zb3.freej2me.bridge.shell.KeyEvent;
                const PointerEvent = await lib.pl.zb3.freej2me.bridge.shell.PointerEvent;

                const evt = await evtQueue.waitForEvent();
                if (evt.kind == 'keydown') {
                    await listener.keyPressed(await new KeyEvent(...evt.args));
                } else if (evt.kind == 'keyup') {
                    await listener.keyReleased(await new KeyEvent(...evt.args));
                } else if (evt.kind == 'pointerpressed') {
                    await listener.pointerPressed(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'pointerdragged') {
                    await listener.pointerDragged(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'pointerreleased') {
                    await listener.pointerReleased(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'player-eom') {
                    await listener.playerEOM(evt.player);
                } else if (evt.kind == 'player-video-frame') {
                    await listener.playerVideoFrame(evt.player);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_restart(lib) {
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_exit(lib) {
                location.href = './';
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sthop(lib) {
                debugger;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_say(lib, sth) {
                console.log('[say]', sth);
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sayObject(lib, label, obj) {
                debugger;
                console.log('[sayobject]', label, obj);
            }
        }
    });

    document.getElementById("loading").textContent = "Loading...";

    watchOrientation();
    const lib = await cheerpjRunLibrary(cheerpjWebRoot+"/freej2me-web.jar");

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;

    let args;

    if (sp.get('app')) {
        const app = sp.get('app');
        await ensureAppInstalled(lib, app);

        args = ['app', sp.get('app')];
    } else {
        const jarPath = cheerpjWebRoot+"/jar/" + (sp.get('jar') || "game.jar");
        await applyResolution(lib, jarPath);
        args = ['jar', jarPath];
    }

    FreeJ2ME.main(args).catch(e => {
        e.printStackTrace();
        document.getElementById('loading').textContent = 'Crash :(';
    });


}

init();