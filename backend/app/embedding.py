"""임베딩 1개.

MVP 기본값은 외부 의존 없는 문자 n-gram 해싱 임베딩(384차원)이다. 한국어 조사 변화에 강하도록
공백 제거 문자 2·3-gram과 어절을 함께 해싱한다. 모델을 바꾸면 EMBED_MODEL 값이 달라지므로
documents.embed_model로 어떤 인덱스 버전인지 추적한다.
"""
import hashlib
import math
import re

DIM = 384
EMBED_MODEL = "hash-ngram-v1-384"

_TOKEN = re.compile(r"[0-9A-Za-z가-힣]+")


def _features(text: str) -> list[str]:
    words = _TOKEN.findall(text.lower())
    feats = [f"w:{w}" for w in words]
    for w in words:
        for n in (2, 3):
            feats.extend(f"g:{w[i:i + n]}" for i in range(max(len(w) - n + 1, 0)))
    return feats


def embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    for feat in _features(text):
        h = int.from_bytes(hashlib.blake2b(feat.encode(), digest_size=8).digest(), "big")
        sign = 1.0 if (h >> 63) & 1 else -1.0
        vec[h % DIM] += sign * (1.5 if feat.startswith("w:") else 1.0)
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]
