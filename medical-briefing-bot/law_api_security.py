import os
from urllib.parse import urlencode


class LawConfigurationError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("LAW_API_KEY is required for the LAW collector")


class LawAPIError(ValueError):
    def __init__(self, failure_type: str) -> None:
        self.failure_type = failure_type
        super().__init__(f"LAW API request failed ({failure_type}); sensitive details withheld")


def require_law_api_key() -> str:
    credential = os.environ.get("LAW_API_KEY", "").strip()
    if not credential:
        raise LawConfigurationError()
    return credential


def build_law_api_url(credential: str, response_type: str = "JSON") -> str:
    query = urlencode({"OC": credential, "target": "law", "type": response_type, "query": "의료법"})
    return f"https://www.law.go.kr/DRF/lawSearch.do?{query}"
