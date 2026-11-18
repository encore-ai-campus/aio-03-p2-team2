"""Vocabulary for inferred interests; explicit/custom profile values remain supported."""

MATCHING_INTERESTS = ("미식", "사진", "산책", "음악", "문화", "전통", "자연", "카페", "액티비티", "공연")


def extracted_interests(values: list[str]) -> list[str]:
    """Do not turn festival titles/tags into preferences or invent related interests."""
    return list(dict.fromkeys(value.strip() for value in values if value.strip() in MATCHING_INTERESTS))
