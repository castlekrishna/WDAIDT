"""Custom application exceptions for WDAIDT Backend."""

class AnalysisException(Exception):
    """Exception carrying an API-agreement-compliant error code, message, and HTTP status."""

    def __init__(self, code: str, message: str, status_code: int = 500, headers: dict = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.headers = headers or {}
