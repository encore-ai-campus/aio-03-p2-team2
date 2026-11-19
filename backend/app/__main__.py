"""Portable Uvicorn launcher: uv run python -m app --reload."""
import asyncio
import sys


def selector_loop():
    loop = asyncio.SelectorEventLoop()
    asyncio.set_event_loop(loop)
    return loop


def main():
    from uvicorn.main import main as uvicorn_main
    sys.argv.insert(1, "app.main:app")
    if sys.platform == "win32":
        sys.argv[2:2] = ["--loop", "app.__main__:selector_loop"]
    uvicorn_main()


if __name__ == "__main__":
    main()
