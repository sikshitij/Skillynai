import re

FILLER_WORDS = ["um", "uh", "like", "you know", "basically", "literally", "sort of", "kind of", "maybe", "probably"]
HEDGE_WORDS = ["i think", "i guess", "i believe", "not sure", "i'm not sure", "might", "could be", "i suppose", "kind of", "sort of"]
ASSERTIVE_WORDS = ["i led", "i built", "i designed", "i implemented", "i delivered", "i achieved", "i managed", "i created", "i solved", "i drove", "i owned", "i launched", "i reduced", "i increased", "i improved", "i developed"]


def analyze_confidence(answer: str) -> float:
    answer_lower = answer.lower()
    word_count = len(answer.split())

    filler_count = sum(1 for w in FILLER_WORDS if w in answer_lower)
    hedge_count = sum(1 for w in HEDGE_WORDS if w in answer_lower)
    assertive_count = sum(1 for w in ASSERTIVE_WORDS if w in answer_lower)

    score = 5.0

    # Reward assertive language
    score += min(assertive_count * 1.0, 3.0)

    # Penalise hedging and filler
    score -= min(hedge_count * 0.8, 2.5)
    score -= min(filler_count * 0.5, 2.0)

    # Penalise very short answers (lack of substance = low confidence)
    if word_count < 20:
        score -= 2.0
    elif word_count >= 60:
        score += 0.5

    return max(round(min(score, 10.0), 1), 1.0)


def analyze_soft_skills(answer: str) -> dict:
    answer_lower = answer.lower()
    word_count = len(answer.split())
    filler_count = sum(1 for w in FILLER_WORDS if w in answer_lower)

    sentences = [s.strip() for s in re.split(r'[.!?]', answer) if s.strip()]
    sentence_count = max(len(sentences), 1)
    avg_sentence_length = word_count / sentence_count

    # Count transition/connective words that show logical flow
    connectives = ["first", "then", "next", "finally", "as a result", "therefore", "however", "additionally", "furthermore", "because", "which led to", "this meant"]
    connective_count = sum(1 for c in connectives if c in answer_lower)

    score = 5.0

    # Reward logical connectives
    score += min(connective_count * 0.8, 2.5)

    # Penalise run-on sentences (hard to follow)
    if avg_sentence_length > 35:
        score -= 2.0
    elif avg_sentence_length > 25:
        score -= 1.0
    elif 10 <= avg_sentence_length <= 20:
        score += 1.0

    # Penalise very short answers
    if word_count < 20:
        score -= 2.0
    elif word_count >= 50:
        score += 0.5

    # Penalise filler words (they hurt clarity)
    score -= min(filler_count * 0.4, 1.5)

    return {
        "clarity_score": max(round(min(score, 10.0), 1), 1.0),
        "filler_count": filler_count,
        "word_count": word_count,
        "filler_words_found": [w for w in FILLER_WORDS if w in answer_lower]
    }


def check_sbr_structure(answer: str) -> dict:
    answer_lower = answer.lower()

    situation_keywords = ["when", "during", "at my", "in my", "while", "situation", "context", "background"]
    behavior_keywords = ["i did", "i took", "i decided", "i implemented", "i worked", "my approach", "i handled", "i solved"]
    result_keywords = ["result", "outcome", "achieved", "improved", "increased", "reduced", "successfully", "as a result", "which led to"]

    has_situation = any(kw in answer_lower for kw in situation_keywords)
    has_behavior = any(kw in answer_lower for kw in behavior_keywords)
    has_result = any(kw in answer_lower for kw in result_keywords)

    sbr_score = 0
    if has_situation:
        sbr_score += 3.3
    if has_behavior:
        sbr_score += 3.3
    if has_result:
        sbr_score += 3.4

    return {
        "sbr_score": round(sbr_score, 1),
        "has_situation": has_situation,
        "has_behavior": has_behavior,
        "has_result": has_result,
        "missing": [
            part for part, present in [
                ("Situation", has_situation),
                ("Behavior", has_behavior),
                ("Result", has_result)
            ] if not present
        ]
    }
