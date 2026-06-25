# pip install websockets
# \u05D4\u05E8\u05E6\u05D4: python server.py

import asyncio
import json
import logging
import random
import re
import string
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

HOST = "0.0.0.0"
PORT = 8765
ROOM_RE = re.compile(r"^[A-Z0-9]{1,10}$")
PROMOTIONS = {None, "Q", "R", "B", "N", "q", "r", "b", "n"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
rooms: dict[str, dict[str, Any]] = {}


def generate_room_id() -> str:
    while True:
        room_id = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
        if room_id not in rooms:
            return room_id


def get_room_of(ws):
    for room_id, room in rooms.items():
        if ws in room["players"]:
            return room_id, room
    return None, None


def valid_square(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("r"), int) and isinstance(value.get("c"), int) \
        and 0 <= value["r"] < 8 and 0 <= value["c"] < 8


async def send_json(ws, payload: dict[str, Any]) -> None:
    await ws.send(json.dumps(payload, ensure_ascii=False))


async def join_room(ws, raw_room: Any) -> None:
    old_room_id, _ = get_room_of(ws)
    if old_room_id:
        await send_json(ws, {"type": "error", "message": "\u05DB\u05D1\u05E8 \u05D4\u05E6\u05D8\u05E8\u05E4\u05EA \u05DC\u05D7\u05D3\u05E8"})
        return

    room_id = str(raw_room or "").strip().upper()
    if not room_id:
        room_id = generate_room_id()
    elif not ROOM_RE.fullmatch(room_id):
        await send_json(ws, {"type": "error", "message": "\u05E7\u05D5\u05D3 \u05D7\u05D3\u05E8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF"})
        return

    room = rooms.setdefault(room_id, {
        "players": [], "colors": {}, "turn": "white", "started": False, "game_over": False
    })

    if len(room["players"]) >= 2:
        await send_json(ws, {"type": "error", "message": "\u05D4\u05D7\u05D3\u05E8 \u05DE\u05DC\u05D0 (2/2)"})
        return

    used_colors = set(room["colors"].values())
    color = "white" if "white" not in used_colors else "black"
    room["players"].append(ws)
    room["colors"][ws] = color

    await send_json(ws, {
        "type": "joined", "room": room_id, "color": color, "players": len(room["players"])
    })
    logging.info("Room %s: player joined as %s (%s/2)", room_id, color, len(room["players"]))

    if len(room["players"]) == 2:
        room["turn"] = "white"
        room["started"] = True
        room["game_over"] = False
        for player in list(room["players"]):
            await send_json(player, {
                "type": "start", "color": room["colors"][player], "room": room_id
            })
    else:
        await send_json(ws, {"type": "waiting", "room": room_id})


async def relay_move(ws, msg: dict[str, Any]) -> None:
    _, room = get_room_of(ws)
    if not room or not room["started"] or room["game_over"]:
        await send_json(ws, {"type": "error", "message": "\u05D0\u05D9\u05DF \u05DE\u05E9\u05D7\u05E7 \u05E4\u05E2\u05D9\u05DC"})
        return

    color = room["colors"].get(ws)
    if color != room["turn"]:
        await send_json(ws, {"type": "error", "message": "\u05D6\u05D4 \u05DC\u05D0 \u05D4\u05EA\u05D5\u05E8 \u05E9\u05DC\u05DA"})
        return

    source, target, promotion = msg.get("from"), msg.get("to"), msg.get("promotion")
    if not valid_square(source) or not valid_square(target) or promotion not in PROMOTIONS:
        await send_json(ws, {"type": "error", "message": "\u05DE\u05D1\u05E0\u05D4 \u05D4\u05DE\u05E1\u05E2 \u05D0\u05D9\u05E0\u05D5 \u05EA\u05E7\u05D9\u05DF"})
        return

    opponent = next((p for p in room["players"] if p is not ws), None)
    if opponent is None:
        await send_json(ws, {"type": "error", "message": "\u05D4\u05D9\u05E8\u05D9\u05D1 \u05D0\u05D9\u05E0\u05D5 \u05DE\u05D7\u05D5\u05D1\u05E8"})
        return

    await send_json(opponent, {
        "type": "move", "from": source, "to": target, "promotion": promotion
    })
    room["turn"] = "black" if room["turn"] == "white" else "white"


async def handler(ws, path=None):
    logging.info("New connection: %s", ws.remote_address)
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                await send_json(ws, {"type": "error", "message": "JSON \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF"})
                continue

            if not isinstance(msg, dict):
                await send_json(ws, {"type": "error", "message": "\u05D4\u05D5\u05D3\u05E2\u05D4 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05E0\u05D4"})
                continue

            msg_type = msg.get("type")
            if msg_type == "join":
                await join_room(ws, msg.get("room"))
            elif msg_type == "move":
                await relay_move(ws, msg)
            elif msg_type == "game_over":
                _, room = get_room_of(ws)
                if room and room["started"] and ws in room["players"]:
                    room["game_over"] = True
            elif msg_type == "resign":
                _, room = get_room_of(ws)
                if room and room["started"] and not room["game_over"]:
                    room["game_over"] = True
                    color = room["colors"].get(ws)
                    for player in list(room["players"]):
                        if player is not ws:
                            await send_json(player, {"type": "resign", "color": color})
            elif msg_type == "chat":
                _, room = get_room_of(ws)
                if room:
                    text = str(msg.get("text", ""))[:300]
                    color = room["colors"].get(ws)
                    for player in list(room["players"]):
                        if player is not ws:
                            await send_json(player, {"type": "chat", "color": color, "text": text})
            else:
                await send_json(ws, {"type": "error", "message": "\u05E1\u05D5\u05D2 \u05D4\u05D5\u05D3\u05E2\u05D4 \u05DC\u05D0 \u05DE\u05D5\u05DB\u05E8"})

    except ConnectionClosed:
        pass
    except Exception:
        logging.exception("Unexpected WebSocket error")
    finally:
        room_id, room = get_room_of(ws)
        if room:
            room["colors"].pop(ws, None)
            if ws in room["players"]:
                room["players"].remove(ws)
            room["started"] = False
            room["game_over"] = False
            room["turn"] = "white"

            for remaining in list(room["players"]):
                try:
                    await send_json(remaining, {"type": "opponent_disconnected"})
                except ConnectionClosed:
                    pass

            if not room["players"]:
                rooms.pop(room_id, None)
                logging.info("Room %s deleted", room_id)
        logging.info("Disconnected: %s", ws.remote_address)


async def main() -> None:
    logging.info("Chess server listening on ws://%s:%s", HOST, PORT)
    async with websockets.serve(handler, HOST, PORT, max_size=16_384, ping_interval=20, ping_timeout=20):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Server stopped")
