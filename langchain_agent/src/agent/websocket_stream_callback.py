# langchain_agent/src/agent/websocket_stream_callback.py
"""
Streams LangChain agent execution (MCP tool lifecycle + optional LLM tokens) to the chat WebSocket.

Uses asyncio.run_coroutine_threadsafe so sync LangChain callbacks can reach the async WebSocket layer.
"""
import asyncio
import logging
from typing import Any, Dict, Optional

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:  # pragma: no cover — older LangChain installs
    try:
        from langchain.callbacks.base import BaseCallbackHandler
    except ImportError:
        from langchain.schema.callbacks.base import BaseCallbackHandler

logger = logging.getLogger(__name__)


class WebSocketStreamCallbackHandler(BaseCallbackHandler):
    """
    Forwards tool start/end/error and optional LLM token deltas to the session WebSocket as stream_event messages.
    """

    def __init__(
        self,
        session_id: str,
        loop: asyncio.AbstractEventLoop,
        websocket_handler: Any,
        stream_mcp_tool_events: bool = True,
        stream_llm_tokens: bool = True,
    ):
        super().__init__()
        self._session_id = session_id
        self._loop = loop
        self._websocket_handler = websocket_handler
        self._stream_mcp_tool_events = stream_mcp_tool_events
        self._stream_llm_tokens = stream_llm_tokens

    def _emit(self, payload: Dict[str, Any]) -> None:
        envelope = {
            "type": "stream_event",
            "session_id": self._session_id,
            **payload,
        }
        try:
            if self._loop is None or self._loop.is_closed():
                return
            asyncio.run_coroutine_threadsafe(
                self._websocket_handler.send_message_to_session(self._session_id, envelope),
                self._loop,
            )
        except Exception as exc:
            logger.debug("stream_event emit skipped: %s", exc)

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[list] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        if not self._stream_mcp_tool_events:
            return
        tool_name = serialized.get("name", "unknown_tool")
        self._emit({"event": "tool_start", "tool": tool_name, "run_id": run_id})

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[list] = None,
        **kwargs: Any,
    ) -> None:
        if not self._stream_mcp_tool_events:
            return
        preview = output[:400] + "…" if len(output) > 400 else output
        self._emit({"event": "tool_end", "run_id": run_id, "output_preview": preview})

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[list] = None,
        **kwargs: Any,
    ) -> None:
        if not self._stream_mcp_tool_events:
            return
        self._emit({"event": "tool_error", "run_id": run_id, "error": str(error)})

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        if not self._stream_llm_tokens or not token:
            return
        self._emit({"event": "llm_token", "token": token})
