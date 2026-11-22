// Ban phim dien thoai that (hidden <input>) -> chuyen thanh phim cho game.
// Them 2 nut nho goc tren phai: [⌨] bat/tat ban phim chu, [🎮] bat/tat phim so/mui ten.
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function initTextInput({ postKey, setPad }) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'vk-input';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'done');
    // font-size >= 16px de iOS khong tu phong to trang khi focus
    input.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;border:0;padding:0;margin:0;font-size:16px;z-index:5;';
    document.body.appendChild(input);

    // hang doi tuan tu de giu dung thu tu ky tu
    let chain = Promise.resolve();
    function enqueue(fn) { chain = chain.then(fn).catch(() => {}); }

    function charKey(ch) {
        const up = ch.toUpperCase();
        let jcode = ch.charCodeAt(0);
        if (ch >= 'a' && ch <= 'z') jcode = up.charCodeAt(0);
        return {
            id: 'V' + ch,
            args: { symbol: ch.charCodeAt(0), jcode, ctrlKey: false, shiftKey: ch !== ch.toLowerCase() }
        };
    }

    async function tap(id, args) {
        postKey(true, id, args);
        await sleep(14);
        postKey(false, id, args);
        await sleep(14);
    }

    const sendChar = ch => enqueue(() => { const k = charKey(ch); return tap(k.id, k.args); });
    const sendSpecial = (id, jcode) => enqueue(() => tap(id, { symbol: '\x00', jcode, ctrlKey: false, shiftKey: false }));
    const sendBackspace = () => sendSpecial('VBackspace', 8);
    const sendEnter = () => sendSpecial('VEnter', 13);

    // doi chieu gia tri cu/moi cua o nhap de biet them/xoa ky tu (ke ca khi go dau tieng Viet)
    let prev = '';
    input.addEventListener('input', () => {
        const cur = input.value;
        let i = 0;
        while (i < prev.length && i < cur.length && prev[i] === cur[i]) i++;
        for (let k = prev.length; k > i; k--) sendBackspace();
        for (const ch of Array.from(cur.slice(i))) sendChar(ch);
        prev = cur;
        if (cur.length > 60) { input.value = ''; prev = ''; } // tranh day o nhap
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendEnter();
            input.value = ''; prev = '';
        } else if (e.key === 'Backspace' && input.value.length === 0) {
            e.preventDefault();
            sendBackspace();
        } else if (e.key === 'Escape') {
            input.blur();
        } else if (e.key.startsWith('Arrow')) {
            const map = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
            e.preventDefault();
            sendSpecial('V' + e.key, map[e.key]);
        }
    });

    input.addEventListener('focus', () => { window.__kbdOpen = true; btnKbd.classList.add('on'); });
    input.addEventListener('blur', () => {
        window.__kbdOpen = false; btnKbd.classList.remove('on');
        input.value = ''; prev = '';
        setTimeout(() => { if (!window.__kbdOpen) document.getElementById('display').focus(); }, 30);
    });

    // --- nut noi ---
    const style = document.createElement('style');
    style.textContent = `
      .vk-btn{position:fixed;top:max(8px,env(safe-area-inset-top));z-index:10;width:44px;height:44px;border-radius:12px;
        border:1px solid rgba(255,255,255,.35);background:rgba(20,20,20,.55);color:#fff;font-size:22px;line-height:1;
        display:flex;align-items:center;justify-content:center;padding:0;-webkit-tap-highlight-color:transparent;user-select:none;}
      .vk-btn.on{background:rgba(40,120,220,.75);}
      #vk-kbd{right:max(8px,env(safe-area-inset-right));}
      #vk-pad{right:calc(max(8px,env(safe-area-inset-right)) + 52px);}
      #vk-smooth{right:calc(max(8px,env(safe-area-inset-right)) + 104px);}
      #vk-fill{right:calc(max(8px,env(safe-area-inset-right)) + 156px);}
      #vk-cfg{right:calc(max(8px,env(safe-area-inset-right)) + 208px);}
      #vk-panel{position:fixed;top:calc(max(8px,env(safe-area-inset-top)) + 54px);right:max(8px,env(safe-area-inset-right));z-index:11;
        background:rgba(20,20,20,.92);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:10px;display:none;
        font:14px -apple-system,sans-serif;min-width:230px;}
      #vk-panel.open{display:block;}
      #vk-panel h4{margin:0 0 8px;font-size:14px;}
      #vk-panel .row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0;}
      #vk-panel button{background:#2a6fd6;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-size:14px;}
      #vk-panel button.off{background:#555;}
      #vk-panel small{color:#bbb;display:block;margin-top:6px;line-height:1.3;}
    `;
    document.head.appendChild(style);

    const btnKbd = document.createElement('button');
    btnKbd.id = 'vk-kbd'; btnKbd.className = 'vk-btn'; btnKbd.textContent = '⌨'; btnKbd.tabIndex = -1;
    btnKbd.setAttribute('aria-label', 'Ban phim');
    btnKbd.addEventListener('click', () => {
        if (document.activeElement === input) input.blur(); else input.focus();
    });

    const btnPad = document.createElement('button');
    btnPad.id = 'vk-pad'; btnPad.className = 'vk-btn'; btnPad.textContent = '🎮'; btnPad.tabIndex = -1;
    btnPad.setAttribute('aria-label', 'Phim so va mui ten');
    let padOn = !!window.__padInitOn;
    btnPad.classList.toggle('on', padOn);
    btnPad.addEventListener('click', () => {
        padOn = !padOn; btnPad.classList.toggle('on', padOn); setPad(padOn);
    });

    // nut chuyen che do phong to: net+muot (mac dinh) <-> pixel vuong
    const btnSm = document.createElement('button');
    btnSm.id = 'vk-smooth'; btnSm.className = 'vk-btn'; btnSm.tabIndex = -1;
    btnSm.setAttribute('aria-label', 'Che do hinh anh');
    function applySmooth() {
        const smooth = window.hthView.smooth;
        btnSm.textContent = smooth ? '✨' : '▦';
        btnSm.classList.toggle('on', smooth);
    }
    btnSm.addEventListener('click', () => {
        window.hthView.setSmooth(!window.hthView.smooth);
        applySmooth();
    });
    applySmooth();

    // nut tran vien (keo gian kin man hinh) <-> giu ti le (co vien den)
    const btnFill = document.createElement('button');
    btnFill.id = 'vk-fill'; btnFill.className = 'vk-btn'; btnFill.tabIndex = -1;
    btnFill.setAttribute('aria-label', 'Tran vien / giu ti le');
    function applyFill() {
        const fill = window.hthView.fill;
        btnFill.textContent = fill ? '⛶' : '▯';
        btnFill.classList.toggle('on', fill);
    }
    btnFill.addEventListener('click', () => {
        window.hthView.setFill(!window.hthView.fill);
        applyFill();
    });
    applyFill();
    document.body.appendChild(btnFill);


    // --- nut cai dat ---
    const btnCfg = document.createElement('button');
    btnCfg.id = 'vk-cfg'; btnCfg.className = 'vk-btn'; btnCfg.textContent = '⚙'; btnCfg.tabIndex = -1;
    btnCfg.setAttribute('aria-label', 'Cai dat');
    const panel = document.createElement('div');
    panel.id = 'vk-panel';
    const C = window.hthCfg;
    function mk(label, getText, onClick, isOn) {
        const row = document.createElement('div'); row.className = 'row';
        const l = document.createElement('span'); l.textContent = label;
        const b = document.createElement('button');
        const upd = () => { b.textContent = getText(); b.classList.toggle('off', !isOn()); };
        b.addEventListener('click', () => { onClick(); upd(); });
        upd(); row.append(l, b); panel.appendChild(row);
    }
    const h = document.createElement('h4'); h.textContent = 'Cài đặt'; panel.appendChild(h);
    const MODE_NAME = { fast: 'Nhanh ⚡', bal: 'Cân bằng', sharp: 'Nét (nặng)' };
    mk('Chế độ (lag → mượt)', () => C.custom ? 'Tùy chỉnh' : (MODE_NAME[C.mode] || 'Cân bằng'),
        () => C.set('mode', C.nextMode(), true), () => true);
    mk('Độ phân giải theo màn hình', () => C.auto ? 'Bật' : 'Tắt (240×320)', () => C.set('auto', !C.auto, true), () => C.auto);
    mk('Chất lượng hình (nhẹ → nét)', () => ['Nhẹ', 'Cân bằng', 'Nét (nặng)'][C.quality] || 'Cân bằng', () => C.set('quality', (C.quality + 1) % 3, true), () => true);
    mk('Độ chi tiết (cạnh ngắn)', () => C.short ? String(C.short) : 'Tự động theo chế độ', () => {
        const opts = [null, 140, 160, 200, 240, 300, 360, 480];
        C.set('short', opts[(opts.indexOf(C.short) + 1) % opts.length], true);
    }, () => true);
    mk('Giới hạn FPS game', () => C.fps ? String(C.fps) : 'Tự do', () => {
        const o = [0, 15, 20, 24, 30, 45, 60]; C.set('fps', o[(o.indexOf(C.fps) + 1) % o.length] || 0, true);
    }, () => true);
    mk('Hiện toạ độ chạm (debug)', () => C.debug ? 'Bật' : 'Tắt', () => C.set('debug', !C.debug, false), () => C.debug);
    const note = document.createElement('small');
    note.textContent = 'Máy yếu / iPhone: để chế độ Nhanh. Đổi mục nào cũng sẽ tải lại game, xoay ngang trước khi vào game.';
    panel.appendChild(note);
    btnCfg.addEventListener('click', () => panel.classList.toggle('open'));
    document.body.appendChild(panel);
    document.body.appendChild(btnCfg);

    document.body.appendChild(btnSm);
    document.body.appendChild(btnPad);
    document.body.appendChild(btnKbd);
}
