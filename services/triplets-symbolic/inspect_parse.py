from __future__ import annotations

import argparse
import json

from bar_triplets_symbolic.engines import make_engine


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect normalized spaCy/Stanza tokens")
    parser.add_argument("--engine", choices=("spacy", "stanza"), required=True)
    parser.add_argument("--language", default="ru")
    parser.add_argument("sentences", nargs="+")
    arguments = parser.parse_args()
    engine = make_engine(arguments.engine, arguments.language)
    for text, tokens in zip(arguments.sentences, engine.parse_many(arguments.sentences), strict=True):
        print(json.dumps({
            "text": text,
            "tokens": [
                {
                    "i": token.index,
                    "text": token.text,
                    "lemma": token.lemma,
                    "pos": token.upos,
                    "dep": token.dependency,
                    "head": token.head,
                    "morphology": token.morphology,
                }
                for token in tokens
            ],
        }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
