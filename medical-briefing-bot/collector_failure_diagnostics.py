import ssl
from typing import Optional, Protocol, Sequence, TypedDict


class SslFailureFields(TypedDict):
    ssl_errno: Optional[int]
    ssl_verify_code: Optional[int]


class HiraFailureFields(TypedDict):
    ready_state: str
    body_text_length: int
    inspection_element_count: int
    visible_inspection_element_count: int


class BrowserPage(Protocol):
    def evaluate(self, expression: str) -> HiraFailureFields: ...


def ssl_failure_fields(chain: Sequence[BaseException]) -> SslFailureFields:
    ssl_error = next((error for error in chain if isinstance(error, ssl.SSLError)), None)
    certificate = next((error for error in chain if isinstance(error, ssl.SSLCertVerificationError)), None)
    errno = ssl_error.errno if ssl_error is not None else None
    verify_code = getattr(certificate, "verify_code", None)
    return {
        "ssl_errno": errno if type(errno) is int else None,
        "ssl_verify_code": verify_code if type(verify_code) is int else None,
    }


def hira_failure_fields(page: BrowserPage) -> HiraFailureFields:
    return page.evaluate("""() => {
        const elements = [...document.querySelectorAll('[id*="MainFrame_Inspect"]')];
        return {
            ready_state: document.readyState,
            body_text_length: document.body ? document.body.innerText.length : 0,
            inspection_element_count: elements.length,
            visible_inspection_element_count: elements.filter(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return rect.width > 0 && rect.height > 0 &&
                    style.display !== 'none' && style.visibility !== 'hidden';
            }).length
        };
    }""")
