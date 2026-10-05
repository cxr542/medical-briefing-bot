import requests

from law_api_security import LawAPIError, build_law_api_url, require_law_api_key


def main() -> None:
    credential = require_law_api_key()
    try:
        response = requests.get(build_law_api_url(credential, "XML"), timeout=10)
    except requests.RequestException as error:
        raise LawAPIError(type(error).__name__) from None
    print(f"LAW API probe HTTP status: {response.status_code}")


if __name__ == "__main__":
    main()
