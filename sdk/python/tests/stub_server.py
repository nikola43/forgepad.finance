"""A local HTTP stub server for the SDK tests.

Nothing in this suite ever touches the network: every test starts one of these
on 127.0.0.1, points a client at it, and asserts on what the client sent.

Responses are queued per ``(method, path)``. When several are queued they are
served in order — that is how the retry tests express "429, then 200". The last
queued response is reused for any further requests.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse


@dataclass
class RecordedRequest:
    """One request the stub received."""

    method: str
    path: str
    query: Dict[str, List[str]]
    body: str
    headers: Dict[str, str]

    def json(self) -> Any:
        """Decode the request body as JSON."""
        return json.loads(self.body)

    def param(self, name: str) -> Optional[str]:
        """First value of a query parameter, or ``None`` when absent."""
        values = self.query.get(name)
        return values[0] if values else None


@dataclass
class CannedResponse:
    """One response the stub will serve."""

    status: int = 200
    body: bytes = b""
    headers: Dict[str, str] = field(default_factory=dict)


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._handle()

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._handle()

    def _handle(self) -> None:
        stub: StubServer = self.server.stub  # type: ignore[attr-defined]
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        stub._record(
            RecordedRequest(
                method=self.command,
                path=parsed.path,
                query=parse_qs(parsed.query, keep_blank_values=True),
                body=raw.decode("utf-8"),
                headers={k.lower(): v for k, v in self.headers.items()},
            )
        )

        canned = stub._next_response(self.command, parsed.path)
        headers = {"Content-Type": "application/json"}
        headers.update(canned.headers)

        self.send_response(canned.status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(canned.body)))
        self.end_headers()
        if canned.body:
            self.wfile.write(canned.body)

    def log_message(self, format: str, *args: Any) -> None:
        """Silence the default stderr access log."""


class StubServer:
    """A threaded HTTP server that replays canned responses."""

    def __init__(self) -> None:
        self._responses: Dict[Tuple[str, str], List[CannedResponse]] = {}
        self._lock = threading.Lock()
        self.requests: List[RecordedRequest] = []
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    # -- lifecycle ----------------------------------------------------

    def start(self) -> StubServer:
        """Start serving on an ephemeral port."""
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._server.stub = self  # type: ignore[attr-defined]
        # A short poll interval keeps stop() from costing half a second per test.
        self._thread = threading.Thread(
            target=lambda: self._server.serve_forever(poll_interval=0.01),  # type: ignore[union-attr]
            daemon=True,
        )
        self._thread.start()
        return self

    def stop(self) -> None:
        """Shut the server down and join its thread."""
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    @property
    def base_url(self) -> str:
        """Base URL to hand to :class:`fyuz.FyuzClient`."""
        assert self._server is not None, "server not started"
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    # -- programming --------------------------------------------------

    def add(
        self,
        method: str,
        path: str,
        *,
        status: int = 200,
        json_body: Any = None,
        raw_body: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> StubServer:
        """Queue a response for ``(method, path)``.

        Args:
            method: HTTP method to match.
            path: Exact path to match (no query string).
            status: Status code to return.
            json_body: Object serialised as the JSON body.
            raw_body: Raw body, for malformed-JSON tests. Wins over
                ``json_body``.
            headers: Extra response headers, e.g. ``Retry-After``.
        """
        if raw_body is not None:
            body = raw_body.encode("utf-8")
        elif json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
        else:
            body = b""
        canned = CannedResponse(status=status, body=body, headers=dict(headers or {}))
        with self._lock:
            self._responses.setdefault((method.upper(), path), []).append(canned)
        return self

    # -- inspection ---------------------------------------------------

    def requests_for(self, method: str, path: str) -> List[RecordedRequest]:
        """Every recorded request matching ``(method, path)``."""
        with self._lock:
            return [r for r in self.requests if r.method == method.upper() and r.path == path]

    def last_request(self) -> RecordedRequest:
        """The most recent recorded request."""
        with self._lock:
            return self.requests[-1]

    # -- internals ----------------------------------------------------

    def _record(self, request: RecordedRequest) -> None:
        with self._lock:
            self.requests.append(request)

    def _next_response(self, method: str, path: str) -> CannedResponse:
        with self._lock:
            queue = self._responses.get((method.upper(), path))
            if not queue:
                body = json.dumps({"error": f"no stub for {method} {path}"}).encode("utf-8")
                return CannedResponse(status=404, body=body)
            return queue.pop(0) if len(queue) > 1 else queue[0]
