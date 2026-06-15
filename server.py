# pip install websockets
# הרצה: python server.py

import asyncio
import json
import random
import string
import websockets

# rooms: { room_id: { "players": [ws1, ws2], "colors": {ws1: "white", ws2: "black"} } }
rooms = {}

def generate_room_id():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))

def get_room_of(ws):
    for room_id, room in rooms.items():
        if ws in room["players"]:
            return room_id, room
    return None, None

async def handler(ws):
    print(f"[+] New connection: {ws.remote_address}")
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send(json.dumps({"type": "error", "message": "Invalid JSON"}))
                continue

            msg_type = msg.get("type")

            # ── JOIN ──────────────────────────────────────────────────────────
            if msg_type == "join":
                room_id = msg.get("room", "").strip().upper()

                # generate a new room if none given
                if not room_id:
                    room_id = generate_room_id()
                    while room_id in rooms:
                        room_id = generate_room_id()

                # create room if it doesn't exist
                if room_id not in rooms:
                    rooms[room_id] = {"players": [], "colors": {}}

                room = rooms[room_id]

                if len(room["players"]) >= 2:
                    await ws.send(json.dumps({"type": "error", "message": "החדר מלא (2/2)"}))
                    continue

                if ws in room["players"]:
                    await ws.send(json.dumps({"type": "error", "message": "כבר מחובר לחדר הזה"}))
                    continue

                # assign color
                color = "white" if len(room["players"]) == 0 else "black"
                room["players"].append(ws)
                room["colors"][ws] = color

                await ws.send(json.dumps({
                    "type": "joined",
                    "room": room_id,
                    "color": color,
                    "players": len(room["players"])
                }))

                print(f"[Room {room_id}] {ws.remote_address} joined as {color} ({len(room['players'])}/2)")

                # if 2 players → start the game
                if len(room["players"]) == 2:
                    for player in room["players"]:
                        await player.send(json.dumps({
                            "type": "start",
                            "color": room["colors"][player],
                            "room": room_id
                        }))
                    print(f"[Room {room_id}] Game started!")
                else:
                    await ws.send(json.dumps({"type": "waiting", "room": room_id}))

            # ── MOVE ─────────────────────────────────────────────────────────
            elif msg_type == "move":
                room_id, room = get_room_of(ws)
                if not room:
                    await ws.send(json.dumps({"type": "error", "message": "אינך בחדר"}))
                    continue

                # make sure it's actually this player's turn
                # (server trusts the client for now — can add validation here)
                opponent = next((p for p in room["players"] if p != ws), None)
                if opponent:
                    await opponent.send(json.dumps({
                        "type": "move",
                        "from": msg.get("from"),
                        "to": msg.get("to"),
                        "promotion": msg.get("promotion")
                    }))

            # ── RESIGN ───────────────────────────────────────────────────────
            elif msg_type == "resign":
                room_id, room = get_room_of(ws)
                if room:
                    color = room["colors"].get(ws, "?")
                    for player in room["players"]:
                        if player != ws:
                            await player.send(json.dumps({"type": "resign", "color": color}))

            # ── CHAT (bonus) ─────────────────────────────────────────────────
            elif msg_type == "chat":
                room_id, room = get_room_of(ws)
                if room:
                    color = room["colors"].get(ws, "?")
                    for player in room["players"]:
                        if player != ws:
                            await player.send(json.dumps({
                                "type": "chat",
                                "color": color,
                                "text": str(msg.get("text", ""))[:300]
                            }))

            else:
                await ws.send(json.dumps({"type": "error", "message": f"Unknown message type: {msg_type}"}))

    except websockets.exceptions.ConnectionClosed:
        pass

    finally:
        # clean up room when player disconnects
        room_id, room = get_room_of(ws)
        if room:
            if ws in room["colors"]:
                del room["colors"][ws]
            if ws in room["players"]:
                room["players"].remove(ws)

            # notify the remaining player
            for remaining in room["players"]:
                try:
                    await remaining.send(json.dumps({"type": "opponent_disconnected"}))
                except Exception:
                    pass

            # delete empty rooms
            if not room["players"]:
                del rooms[room_id]
                print(f"[Room {room_id}] Deleted (empty)")
            else:
                print(f"[Room {room_id}] Player left, {len(room['players'])} remaining")

        print(f"[-] Disconnected: {ws.remote_address}")


async def main():
    print("=" * 45)
    print("  Chess WebSocket Server")
    print("  ws://localhost:8765")
    print("  Ctrl+C to stop")
    print("=" * 45)
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()

asyncio.run(main())