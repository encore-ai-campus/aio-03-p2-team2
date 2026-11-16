"""psycopg on Windows requires a selector loop, like the application launcher."""
import asyncio
import sys
import pytest


@pytest.hookimpl(optionalhook=True)
def pytest_asyncio_loop_factories(config, item):
    if sys.platform == "win32":
        return {"selector": asyncio.SelectorEventLoop}
    return {"default": asyncio.new_event_loop}
