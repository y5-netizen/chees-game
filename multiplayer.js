// multiplayer.js — טען אחרי script.js
// =====================================================
// לא צריך לשנות שום דבר ב-script.js או index.html
// רק להוסיף: <script src="multiplayer.js"></script>
// =====================================================

const mp = {
    ws: null,
    active: false,       // האם מצב מולטיפלייר פעיל
    myColor: null,       // 'white' | 'black'
    roomId: null,
    applyingRemote: false  // מונע לולאה אינסופית בעת קבלת מהלך
};

// ─── Override canPlayerMove ────────────────────────────────────────────────
// נשמור את הפונקציה המקורית (שבודקת AI)
const _origCanPlayerMove = window.canPlayerMove;
window.canPlayerMove = function () {
    if (mp.active) {
        // במצב מולטיפלייר — מותר לזוז רק אם זה התור שלנו
        return engine.turn === mp.myColor;
    }
    return _origCanPlayerMove ? _origCanPlayerMove() : true;
};

// ─── Hook makeMove — שליחת מהלך מקומי לשרת ───────────────────────────────
const _mpOrigMakeMove = engine.makeMove.bind(engine);
engine.makeMove = function (fr, fc, tr, tc, promo = null) {
    const result = _mpOrigMakeMove(fr, fc, tr, tc, promo);
    if (mp.active && !mp.applyingRemote && result !== false) {
        mp.sendMove(fr, fc, tr, tc, promo);
    }
    return result;
};

// ─── שליחת מהלך ───────────────────────────────────────────────────────────
mp.sendMove = function (fr, fc, tr, tc, promo) {
    if (!mp.ws || mp.ws.readyState !== WebSocket.OPEN) return;
    mp.ws.send(JSON.stringify({
        type: 'move',
        from: { r: fr, c: fc },
        to: { r: tr, c: tc },
        promotion: promo || null
    }));
};

// ─── חיבור לשרת ───────────────────────────────────────────────────────────
mp.connect = function (serverUrl, roomId) {
    if (mp.ws) mp.ws.close();

    mpSetStatus('מתחבר...', 'connecting');

    try {
        mp.ws = new WebSocket(serverUrl);
    } catch (e) {
        mpSetStatus('כתובת שרת לא תקינה', 'error');
        return;
    }

    mp.ws.onopen = () => {
        mpSetStatus('מחובר, מצטרף לחדר...', 'connecting');
        mp.ws.send(JSON.stringify({ type: 'join', room: roomId || '' }));
    };

    mp.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        mp.handleMessage(msg);
    };

    mp.ws.onclose = () => {
        if (mp.active) {
            mpSetStatus('החיבור נותק', 'error');
            mp.active = false;
        }
    };

    mp.ws.onerror = () => {
        mpSetStatus('שגיאת חיבור — ודא שהשרת רץ', 'error');
    };
};

// ─── טיפול בהודעות נכנסות ────────────────────────────────────────────────
mp.handleMessage = function (msg) {
    switch (msg.type) {

        case 'joined':
            mp.roomId = msg.room;
            document.getElementById('mp-room-display').textContent = msg.room;
            document.getElementById('mp-room-display-row').style.display = 'flex';
            mpSetStatus(`ממתין ליריב... (${msg.players}/2)`, 'waiting');
            break;

        case 'waiting':
            mpSetStatus('ממתין ליריב...', 'waiting');
            break;

        case 'start':
            mp.active = true;
            mp.myColor = msg.color;
            mp.roomId = msg.room;

            // reset game
            engine.reset();
            ui.selectedSquare = null;
            ui.possibleMoves = [];
            // הפוך לוח לשחור
            ui.isFlipped = (mp.myColor === 'black');
            ui.renderBoard();
            if (typeof renderMoveList === 'function') renderMoveList();

            // כבה AI אם היה פעיל
            if (typeof aiEnabled !== 'undefined') {
                aiEnabled = false;
                const sp = document.getElementById('ai-status');
                if (sp) sp.textContent = 'כבוי';
                const ac = document.getElementById('ai-controls');
                if (ac) ac.style.display = 'none';
            }
            if (window.aiPlayer) window.aiPlayer.stop();

            const colorHe = mp.myColor === 'white' ? 'לבן' : 'שחור';
            mpSetStatus(`משחק התחיל! אתה משחק כ${colorHe}`, 'active');
            mpShowColorBadge(mp.myColor);
            document.getElementById('mp-resign-btn').style.display = 'inline-block';
            break;

        case 'move':
            // קבל מהלך מהיריב ובצע אותו על הלוח
            mp.applyingRemote = true;
            const result = engine.makeMove(
                msg.from.r, msg.from.c,
                msg.to.r, msg.to.c,
                msg.promotion || null
            );
            mp.applyingRemote = false;

            if (result !== false) {
                ui.selectedSquare = null;
                ui.possibleMoves = [];
                ui.renderBoard();
                if (typeof renderMoveList === 'function') renderMoveList();
                if (result && result !== null) {
                    ui.showGameOver && ui.showGameOver(result);
                }
            }
            break;

        case 'resign':
            const resignColor = msg.color === 'white' ? 'הלבן' : 'השחור';
            alert(`${resignColor} נכנע — ניצחת!`);
            mp.active = false;
            mpSetStatus('המשחק הסתיים', 'waiting');
            break;

        case 'opponent_disconnected':
            mpSetStatus('היריב התנתק', 'error');
            mp.active = false;
            alert('היריב התנתק מהמשחק.');
            break;

        case 'error':
            mpSetStatus(`שגיאה: ${msg.message}`, 'error');
            break;
    }
};

// ─── UI: בניית פאנל המולטיפלייר ──────────────────────────────────────────
function buildMpPanel() {
    const panel = document.createElement('div');
    panel.id = 'mp-panel';
    panel.innerHTML = `
        <div id="mp-header">
            <span>🌐 מולטיפלייר</span>
            <button id="mp-toggle-btn" onclick="mpToggleExpand()">▲</button>
        </div>
        <div id="mp-body">
            <div class="mp-row">
                <label>שרת (ws://)</label>
                <input id="mp-server-input" type="text" value="ws://localhost:8765" placeholder="ws://...">
            </div>
            <div class="mp-row">
                <label>קוד חדר (ריק = חדש)</label>
                <input id="mp-room-input" type="text" placeholder="ABCDE" maxlength="10" style="text-transform:uppercase">
            </div>
            <button id="mp-connect-btn" onclick="mpConnect()">התחבר</button>
            <button id="mp-disconnect-btn" onclick="mpDisconnect()" style="display:none;background:#c0392b">התנתק</button>
            <button id="mp-resign-btn" onclick="mpResign()" style="display:none;background:#8e44ad">כניעה</button>

            <div id="mp-room-display-row" style="display:none;" class="mp-row">
                <label>קוד החדר שלך:</label>
                <strong id="mp-room-display" style="font-size:18px;letter-spacing:2px;cursor:pointer"
                    onclick="mpCopyRoom()" title="לחץ להעתקה">─</strong>
            </div>

            <div id="mp-color-badge" style="display:none"></div>
            <div id="mp-status" class="mp-status">לא מחובר</div>
        </div>
    `;

    // CSS
    const style = document.createElement('style');
    style.textContent = `
        #mp-panel {
            position: fixed;
            bottom: 16px;
            left: 12px;
            width: 270px;
            background: #1e1c1a;
            border: 1px solid #444;
            border-radius: 10px;
            z-index: 200;
            font-size: 13px;
            color: #eee;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            direction: rtl;
        }
        #mp-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #2c2a27;
            border-radius: 10px 10px 0 0;
            font-weight: bold;
            cursor: pointer;
        }
        #mp-toggle-btn {
            background: none;
            border: none;
            color: #aaa;
            font-size: 12px;
            padding: 0;
            margin: 0;
            cursor: pointer;
        }
        #mp-body {
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 7px;
        }
        .mp-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .mp-row label { min-width: 90px; color: #aaa; font-size: 12px; }
        #mp-panel input {
            flex: 1;
            background: #2e2b28;
            border: 1px solid #555;
            color: #fff;
            border-radius: 5px;
            padding: 4px 7px;
            font-size: 13px;
        }
        #mp-panel button {
            width: 100%;
            padding: 7px;
            border-radius: 6px;
            border: none;
            font-weight: bold;
            cursor: pointer;
            font-size: 13px;
            margin-top: 2px;
            color: white;
            background: #81b64c;
        }
        #mp-panel button:hover { filter: brightness(1.15); }
        .mp-status {
            text-align: center;
            padding: 5px;
            border-radius: 5px;
            font-size: 12px;
            background: #2a2826;
        }
        .mp-status.connecting { color: #f0ad4e; }
        .mp-status.waiting    { color: #5bc0de; }
        .mp-status.active     { color: #5cb85c; }
        .mp-status.error      { color: #d9534f; }
        #mp-color-badge {
            text-align: center;
            padding: 4px 8px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 13px;
        }
        #mp-color-badge.white-badge { background: #f5f5f5; color: #222; }
        #mp-color-badge.black-badge { background: #222; color: #eee; border: 1px solid #555; }
        #mp-body.collapsed { display: none; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);
}

// ─── פונקציות UI ───────────────────────────────────────────────────────────
function mpSetStatus(text, cls = '') {
    const el = document.getElementById('mp-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'mp-status ' + cls;
}

function mpShowColorBadge(color) {
    const el = document.getElementById('mp-color-badge');
    if (!el) return;
    el.textContent = color === 'white' ? '⬜ אתה משחק לבן' : '⬛ אתה משחק שחור';
    el.className = color === 'white' ? 'white-badge' : 'black-badge';
    el.style.display = 'block';
}

function mpToggleExpand() {
    const body = document.getElementById('mp-body');
    const btn = document.getElementById('mp-toggle-btn');
    if (!body) return;
    const collapsed = body.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▼' : '▲';
}

function mpConnect() {
    const server = document.getElementById('mp-server-input').value.trim();
    const room = document.getElementById('mp-room-input').value.trim().toUpperCase();
    if (!server) { alert('הכנס כתובת שרת'); return; }

    document.getElementById('mp-connect-btn').style.display = 'none';
    document.getElementById('mp-disconnect-btn').style.display = 'inline-block';

    mp.connect(server, room);
}

function mpDisconnect() {
    if (mp.ws) mp.ws.close();
    mp.active = false;
    mp.myColor = null;
    mp.roomId = null;
    document.getElementById('mp-connect-btn').style.display = 'inline-block';
    document.getElementById('mp-disconnect-btn').style.display = 'none';
    document.getElementById('mp-resign-btn').style.display = 'none';
    document.getElementById('mp-room-display-row').style.display = 'none';
    document.getElementById('mp-color-badge').style.display = 'none';
    mpSetStatus('לא מחובר', '');
}

function mpResign() {
    if (!mp.ws || !mp.active) return;
    if (!confirm('להיכנע?')) return;
    mp.ws.send(JSON.stringify({ type: 'resign' }));
    mp.active = false;
    mpSetStatus('נכנעת', 'waiting');
    document.getElementById('mp-resign-btn').style.display = 'none';
}

function mpCopyRoom() {
    const code = document.getElementById('mp-room-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const el = document.getElementById('mp-room-display');
        const orig = el.textContent;
        el.textContent = '✓ הועתק';
        setTimeout(() => el.textContent = orig, 1500);
    });
}

// ─── אתחול: בנה את הפאנל ─────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildMpPanel);
} else {
    buildMpPanel();
}