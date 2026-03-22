#!/usr/bin/env python3
"""
LAN TCP relay for Mission Control.
Listens on RELAY_BIND_HOST:RELAY_PORT (default 192.168.0.11:3244) and
forwards all traffic to UPSTREAM_HOST:UPSTREAM_PORT (default 127.0.0.1:3244).

macOS Application Firewall trusts system Python (/usr/bin/python3) but
blocks Homebrew Node, so this relay allows LAN browser access without
opening firewall rules for Node.

Usage (via launchd): automatically started by ai.missioncontrol.lanrelay
"""

import asyncio
import os
import sys
import signal

RELAY_BIND_HOST = os.environ.get("RELAY_BIND_HOST", "0.0.0.0")
RELAY_PORT = int(os.environ.get("RELAY_PORT", "3244"))
UPSTREAM_HOST = os.environ.get("UPSTREAM_HOST", "127.0.0.1")
UPSTREAM_PORT = int(os.environ.get("UPSTREAM_PORT", "3244"))


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection(
            UPSTREAM_HOST, UPSTREAM_PORT
        )
    except (ConnectionRefusedError, OSError):
        client_writer.close()
        return

    await asyncio.gather(
        pipe(client_reader, upstream_writer),
        pipe(upstream_reader, client_writer),
        return_exceptions=True,
    )


async def main() -> None:
    server = await asyncio.start_server(
        handle,
        RELAY_BIND_HOST,
        RELAY_PORT,
        reuse_address=True,
    )
    addrs = ", ".join(str(s.getsockname()) for s in server.sockets)
    print(f"lan-relay: listening on {addrs} → {UPSTREAM_HOST}:{UPSTREAM_PORT}", flush=True)

    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set_result, None)

    async with server:
        await stop


if __name__ == "__main__":
    asyncio.run(main())
