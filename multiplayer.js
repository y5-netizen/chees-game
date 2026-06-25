// multiplayer.js \u2014 \u05D9\u05E9 \u05DC\u05D8\u05E2\u05D5\u05DF \u05D0\u05D7\u05E8\u05D9 script.js
const mp = {
    ws: null,
    active: false,
    myColor: null,
    roomId: null,
    applyingRemote: false,
    manualClose: false
};
window.mp = mp;

const originalCanPlayerMove = window.canPlayerMove;
window.canPlayerMove = function () {
    if (mp.active) return !engine.isGameOver && engine.turn === mp.myColor;
    return originalCanPlayerMove ? originalCanPlayerMove() : true;
};

const multiplayerBaseMakeMove = engine.makeMove.bind(engine);
engine.makeMove = function (fr, fc, tr, tc, promo = null) {
    const result = multiplayerBaseMakeMove(fr, fc, tr, tc, promo);
    if (result !== false && mp.active && !mp.applyingRemote) {
        mp.sendMove(fr, fc, tr, tc, promo);
        if (result) {
            if (mp.ws && mp.ws.readyState === WebSocket.OPEN) {
                mp.ws.send(JSON.stringify({ type: 'game_over' }));
            }
            mp.active = false;
            mpSetStatus('\u05D4\u05DE\u05E9\u05D7\u05E7 \u05D4\u05E1\u05EA\u05D9\u05D9\u05DD', 'waiting');
            setDisplay('mp-resign-btn', 'none');
        }
    }
    return result;
};

mp.sendMove = function (fr, fc, tr, tc, promo) {
    if (!mp.ws || mp.ws.readyState !== WebSocket.OPEN) return;
    mp.ws.send(JSON.stringify({
        type: 'move',
        from: { r: fr, c: fc },
        to: { r: tr, c: tc },
        promotion: promo || null
    }));
};

mp.connect = function (serverUrl, roomId) {
    mpDisconnect(false);
    mp.manualClose = false;
    mpSetStatus('\u05DE\u05EA\u05D7\u05D1\u05E8...', 'connecting');

    let socket;
    try {
        socket = new WebSocket(serverUrl);
    } catch (error) {
        mpSetStatus('\u05DB\u05EA\u05D5\u05D1\u05EA \u05D4\u05E9\u05E8\u05EA \u05D0\u05D9\u05E0\u05D4 \u05EA\u05E7\u05D9\u05E0\u05D4', 'error');
        mpResetButtons();
        return;
    }
    mp.ws = socket;

    socket.onopen = () => {
        if (mp.ws !== socket) return;
        mpSetStatus('\u05DE\u05D7\u05D5\u05D1\u05E8, \u05DE\u05E6\u05D8\u05E8\u05E3 \u05DC\u05D7\u05D3\u05E8...', 'connecting');
        socket.send(JSON.stringify({ type: 'join', room: roomId || '' }));
    };

    socket.onmessage = event => {
        if (mp.ws !== socket) return;
        try {
            mp.handleMessage(JSON.parse(event.data));
        } catch (error) {
            console.warn('\u05D4\u05EA\u05E7\u05D1\u05DC\u05D4 \u05D4\u05D5\u05D3\u05E2\u05D4 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05E0\u05D4 \u05DE\u05D4\u05E9\u05E8\u05EA', error);
        }
    };

    socket.onerror = () => {
        if (mp.ws !== socket) return;
        mpSetStatus('\u05E9\u05D2\u05D9\u05D0\u05EA \u05D7\u05D9\u05D1\u05D5\u05E8 \u2014 \u05D5\u05D3\u05D0 \u05E9\u05D4\u05E9\u05E8\u05EA \u05E4\u05D5\u05E2\u05DC \u05D5\u05E9\u05D4\u05E4\u05E8\u05D5\u05D8\u05D5\u05E7\u05D5\u05DC \u05DE\u05EA\u05D0\u05D9\u05DD', 'error');
    };

    socket.onclose = () => {
        if (mp.ws !== socket) return;
        mp.ws = null;
        const wasActive = mp.active;
        mp.active = false;
        mp.myColor = null;
        if (!mp.manualClose) {
            mpSetStatus(wasActive ? '\u05D4\u05D7\u05D9\u05D1\u05D5\u05E8 \u05E0\u05D5\u05EA\u05E7' : '\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D4\u05EA\u05D7\u05D1\u05E8', 'error');
        }
        mpResetButtons();
    };
};

mp.handleMessage = function (msg) {
    switch (msg.type) {
        case 'joined':
            mp.roomId = msg.room;
            setText('mp-room-display', msg.room);
            setDisplay('mp-room-display-row', 'flex');
            mpSetStatus(`\u05DE\u05DE\u05EA\u05D9\u05DF \u05DC\u05D9\u05E8\u05D9\u05D1... (${msg.players}/2)`, 'waiting');
            break;

        case 'waiting':
            mpSetStatus('\u05DE\u05DE\u05EA\u05D9\u05DF \u05DC\u05D9\u05E8\u05D9\u05D1...', 'waiting');
            break;

        case 'start':
            mp.active = true;
            mp.myColor = msg.color;
            mp.roomId = msg.room;

            if (window.aiPlayer) window.aiPlayer.stop();
            if (typeof aiEnabled !== 'undefined') aiEnabled = false;
            setText('ai-status', '\u05DB\u05D1\u05D5\u05D9');
            setDisplay('ai-controls', 'none');
            if (typeof removeClock === 'function' && typeof clockInstance !== 'undefined' && clockInstance) {
                removeClock();
            }

            engine.reset();
            if (typeof window.startNewSavedGame === 'function') window.startNewSavedGame();
            ui.selectedSquare = null;
            ui.possibleMoves = [];
            ui.isFlipped = mp.myColor === 'black';
            ui.renderBoard();
            renderMoveList();

            const colorHe = mp.myColor === 'white' ? '\u05DC\u05D1\u05DF' : '\u05E9\u05D7\u05D5\u05E8';
            mpSetStatus(`\u05D4\u05DE\u05E9\u05D7\u05E7 \u05D4\u05EA\u05D7\u05D9\u05DC \u2014 \u05D0\u05EA\u05D4 \u05DE\u05E9\u05D7\u05E7 ${colorHe}`, 'active');
            mpShowColorBadge(mp.myColor);
            setDisplay('mp-resign-btn', 'inline-block');
            break;

        case 'move': {
            if (!validMovePayload(msg)) {
                mpSetStatus('\u05D4\u05EA\u05E7\u05D1\u05DC \u05DE\u05E1\u05E2 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF \u05DE\u05D4\u05E9\u05E8\u05EA', 'error');
                return;
            }

            let result = false;
            mp.applyingRemote = true;
            try {
                result = engine.makeMove(
                    msg.from.r, msg.from.c,
                    msg.to.r, msg.to.c,
                    msg.promotion || null
                );
            } finally {
                mp.applyingRemote = false;
            }

            if (result === false) {
                mpSetStatus('\u05D4\u05DE\u05E1\u05E2 \u05E9\u05DC \u05D4\u05D9\u05E8\u05D9\u05D1 \u05E0\u05D3\u05D7\u05D4 \u05DB\u05DC\u05D0 \u05D7\u05D5\u05E7\u05D9', 'error');
                return;
            }

            ui.selectedSquare = null;
            ui.possibleMoves = [];
            ui.renderBoard();
            renderMoveList();
            if (result) {
                mp.active = false;
                ui.showGameOver(result);
                setDisplay('mp-resign-btn', 'none');
            }
            break;
        }

        case 'resign': {
            const resignColor = msg.color === 'white' ? '\u05D4\u05DC\u05D1\u05DF' : '\u05D4\u05E9\u05D7\u05D5\u05E8';
            alert(`${resignColor} \u05E0\u05DB\u05E0\u05E2 \u2014 \u05E0\u05D9\u05E6\u05D7\u05EA!`);
            engine.isGameOver = true;
            engine.gameResult = msg.color === 'white' ? 'black' : 'white';
            if (typeof window.autoSaveFinishedGame === 'function') window.autoSaveFinishedGame();
            mp.active = false;
            mpSetStatus('\u05D4\u05DE\u05E9\u05D7\u05E7 \u05D4\u05E1\u05EA\u05D9\u05D9\u05DD', 'waiting');
            setDisplay('mp-resign-btn', 'none');
            break;
        }

        case 'opponent_disconnected':
            mp.active = false;
            mpSetStatus('\u05D4\u05D9\u05E8\u05D9\u05D1 \u05D4\u05EA\u05E0\u05EA\u05E7', 'error');
            setDisplay('mp-resign-btn', 'none');
            alert('\u05D4\u05D9\u05E8\u05D9\u05D1 \u05D4\u05EA\u05E0\u05EA\u05E7 \u05DE\u05D4\u05DE\u05E9\u05D7\u05E7.');
            break;

        case 'error':
            mpSetStatus(`\u05E9\u05D2\u05D9\u05D0\u05D4: ${msg.message || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05DC\u05D0 \u05D9\u05D3\u05D5\u05E2\u05D4'}`, 'error');
            if (!mp.active) mpResetButtons();
            break;
    }
};

function validMovePayload(msg) {
    const validSquare = s => s && Number.isInteger(s.r) && Number.isInteger(s.c) &&
        s.r >= 0 && s.r < 8 && s.c >= 0 && s.c < 8;
    return validSquare(msg.from) && validSquare(msg.to) &&
        (msg.promotion == null || ['Q','R','B','N','q','r','b','n'].includes(msg.promotion));
}

function buildMpPanel() {
    if (document.getElementById('mp-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'mp-panel';
    panel.innerHTML = `
        <div id="mp-header">
            <span>\uD83C\uDF10 \u05DE\u05D5\u05DC\u05D8\u05D9\u05E4\u05DC\u05D9\u05D9\u05E8</span>
            <button id="mp-toggle-btn" type="button">\u25B2</button>
        </div>
        <div id="mp-body">
            <div class="mp-row"><label for="mp-server-input">\u05E9\u05E8\u05EA</label>
                <input id="mp-server-input" type="text" value="ws://localhost:8765" placeholder="ws://..."></div>
            <div class="mp-row"><label for="mp-room-input">\u05E7\u05D5\u05D3 \u05D7\u05D3\u05E8</label>
                <input id="mp-room-input" type="text" placeholder="\u05E8\u05D9\u05E7 = \u05D7\u05D3\u05E8 \u05D7\u05D3\u05E9" maxlength="10"></div>
            <button id="mp-connect-btn" type="button">\u05D4\u05EA\u05D7\u05D1\u05E8</button>
            <button id="mp-disconnect-btn" type="button" style="display:none;background:#c0392b">\u05D4\u05EA\u05E0\u05EA\u05E7</button>
            <button id="mp-resign-btn" type="button" style="display:none;background:#8e44ad">\u05DB\u05E0\u05D9\u05E2\u05D4</button>
            <div id="mp-room-display-row" style="display:none" class="mp-row">
                <label>\u05E7\u05D5\u05D3 \u05D4\u05D7\u05D3\u05E8:</label><strong id="mp-room-display" title="\u05DC\u05D7\u05E5 \u05DC\u05D4\u05E2\u05EA\u05E7\u05D4">\u2500</strong>
            </div>
            <div id="mp-color-badge" style="display:none"></div>
            <div id="mp-status" class="mp-status">\u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8</div>
        </div>`;

    const style = document.createElement('style');
    style.textContent = `
        #mp-panel{position:fixed;bottom:16px;left:12px;width:270px;background:#1e1c1a;border:1px solid #444;border-radius:10px;z-index:200;font-size:13px;color:#eee;box-shadow:0 4px 16px rgba(0,0,0,.5);direction:rtl}
        #mp-header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#2c2a27;border-radius:10px 10px 0 0;font-weight:bold}
        #mp-toggle-btn{background:none!important;border:0;color:#aaa;padding:0!important;margin:0!important;width:auto!important}
        #mp-body{padding:10px 12px;display:flex;flex-direction:column;gap:7px}
        #mp-body.collapsed{display:none}.mp-row{display:flex;align-items:center;gap:6px}.mp-row label{min-width:78px;color:#aaa;font-size:12px}
        #mp-panel input{min-width:0;flex:1;background:#2e2b28;border:1px solid #555;color:#fff;border-radius:5px;padding:5px 7px}
        #mp-panel button{width:100%;padding:7px;border:0;border-radius:6px;font-weight:bold;cursor:pointer;color:#fff;background:#81b64c}
        .mp-status{text-align:center;padding:5px;border-radius:5px;background:#2a2826}.mp-status.connecting{color:#f0ad4e}.mp-status.waiting{color:#5bc0de}.mp-status.active{color:#5cb85c}.mp-status.error{color:#d9534f}
        #mp-color-badge{text-align:center;padding:5px 8px;border-radius:6px;font-weight:bold}.white-badge{background:#f5f5f5;color:#222}.black-badge{background:#222;color:#eee;border:1px solid #555}
        @media(max-width:700px){#mp-panel{position:static;width:calc(100% - 20px);margin:10px}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById('mp-toggle-btn').addEventListener('click', mpToggleExpand);
    document.getElementById('mp-connect-btn').addEventListener('click', mpConnect);
    document.getElementById('mp-disconnect-btn').addEventListener('click', () => mpDisconnect(true));
    document.getElementById('mp-resign-btn').addEventListener('click', mpResign);
    document.getElementById('mp-room-display').addEventListener('click', mpCopyRoom);

    if (location.protocol === 'https:' && document.getElementById('mp-server-input').value.startsWith('ws://')) {
        mpSetStatus('\u05E9\u05D9\u05DD \u05DC\u05D1: \u05D3\u05E3 HTTPS \u05E2\u05DC\u05D5\u05DC \u05DC\u05D7\u05E1\u05D5\u05DD \u05E9\u05E8\u05EA ws://. \u05D4\u05E8\u05E5 \u05D0\u05EA \u05D4\u05D0\u05EA\u05E8 \u05D1-HTTP \u05D0\u05D5 \u05D4\u05D2\u05D3\u05E8 WSS.', 'waiting');
    }
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setDisplay(id, display) { const el = document.getElementById(id); if (el) el.style.display = display; }
function mpSetStatus(text, cls = '') { const el = document.getElementById('mp-status'); if (el) { el.textContent = text; el.className = `mp-status ${cls}`; } }
function mpShowColorBadge(color) { const el = document.getElementById('mp-color-badge'); if (!el) return; el.textContent = color === 'white' ? '\u2B1C \u05D0\u05EA\u05D4 \u05DE\u05E9\u05D7\u05E7 \u05DC\u05D1\u05DF' : '\u2B1B \u05D0\u05EA\u05D4 \u05DE\u05E9\u05D7\u05E7 \u05E9\u05D7\u05D5\u05E8'; el.className = color === 'white' ? 'white-badge' : 'black-badge'; el.style.display = 'block'; }
function mpResetButtons() { setDisplay('mp-connect-btn', 'inline-block'); setDisplay('mp-disconnect-btn', 'none'); setDisplay('mp-resign-btn', 'none'); }

function mpToggleExpand() {
    const body = document.getElementById('mp-body');
    const btn = document.getElementById('mp-toggle-btn');
    if (!body || !btn) return;
    btn.textContent = body.classList.toggle('collapsed') ? '\u25BC' : '\u25B2';
}

function mpConnect() {
    const serverEl = document.getElementById('mp-server-input');
    const roomEl = document.getElementById('mp-room-input');
    const server = serverEl.value.trim();
    const room = roomEl.value.trim().toUpperCase();
    if (!/^wss?:\/\//i.test(server)) { alert('\u05DB\u05EA\u05D5\u05D1\u05EA \u05D4\u05E9\u05E8\u05EA \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05D1-ws:// \u05D0\u05D5 wss://'); return; }
    if (room && !/^[A-Z0-9]{1,10}$/.test(room)) { alert('\u05E7\u05D5\u05D3 \u05D4\u05D7\u05D3\u05E8 \u05D9\u05DB\u05D5\u05DC \u05DC\u05D4\u05DB\u05D9\u05DC \u05E8\u05E7 \u05D0\u05D5\u05EA\u05D9\u05D5\u05EA \u05D1\u05D0\u05E0\u05D2\u05DC\u05D9\u05EA \u05D5\u05DE\u05E1\u05E4\u05E8\u05D9\u05DD.'); return; }
    setDisplay('mp-connect-btn', 'none');
    setDisplay('mp-disconnect-btn', 'inline-block');
    mp.connect(server, room);
}

function mpDisconnect(showStatus = true) {
    const socket = mp.ws;
    mp.manualClose = true;
    mp.ws = null;
    mp.active = false;
    mp.myColor = null;
    mp.roomId = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    mpResetButtons();
    setDisplay('mp-room-display-row', 'none');
    setDisplay('mp-color-badge', 'none');
    if (showStatus) mpSetStatus('\u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8');
}

function mpResign() {
    if (!mp.ws || !mp.active || !confirm('\u05DC\u05D4\u05D9\u05DB\u05E0\u05E2?')) return;
    engine.isGameOver = true;
    engine.gameResult = mp.myColor === 'white' ? 'black' : 'white';
    mp.ws.send(JSON.stringify({ type: 'resign' }));
    if (typeof window.autoSaveFinishedGame === 'function') window.autoSaveFinishedGame();
    mp.active = false;
    mpSetStatus('\u05E0\u05DB\u05E0\u05E2\u05EA', 'waiting');
    setDisplay('mp-resign-btn', 'none');
}

async function mpCopyRoom() {
    const el = document.getElementById('mp-room-display');
    const code = el ? el.textContent : '';
    if (!code || code === '\u2500') return;
    try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(code);
        else {
            const temp = document.createElement('textarea');
            temp.value = code; document.body.appendChild(temp); temp.select();
            document.execCommand('copy'); temp.remove();
        }
        const original = el.textContent; el.textContent = '\u2713 \u05D4\u05D5\u05E2\u05EA\u05E7';
        setTimeout(() => { el.textContent = original; }, 1500);
    } catch { mpSetStatus('\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D4\u05E2\u05EA\u05D9\u05E7 \u05D0\u05EA \u05E7\u05D5\u05D3 \u05D4\u05D7\u05D3\u05E8', 'error'); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildMpPanel);
else buildMpPanel();
