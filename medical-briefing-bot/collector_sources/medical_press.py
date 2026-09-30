"""Quality filtering shared by the medical press RSS collectors."""

BLACK_LIST = ("인사", "부음", "홍보", "광고", "동정", "출시", "프로모션")


def is_valid_press_article(title: str) -> bool:
    """Keep structurally valid press items unless a known low-value term appears."""
    return not any(blacklisted_term in title for blacklisted_term in BLACK_LIST)
