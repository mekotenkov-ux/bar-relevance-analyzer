from __future__ import annotations

import argparse
from pathlib import Path

import stanza


PROCESSORS = {
    "ru": {
        "tokenize": "syntagrus",
        "lemma": "syntagrus_nocharlm",
        "pos": "syntagrus_nocharlm",
        "depparse": "syntagrus_nocharlm",
    },
    "en": {
        "tokenize": "combined_nocharlm",
        "mwt": "combined",
        "lemma": "combined_nocharlm",
        "pos": "combined_nocharlm",
        "depparse": "combined_nocharlm",
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Download only the light Stanza processors used by BAR")
    parser.add_argument("languages", nargs="*", choices=sorted(PROCESSORS), default=["ru", "en"])
    parser.add_argument("--model-dir", default=str(Path(__file__).with_name(".stanza-models")))
    arguments = parser.parse_args()
    for language in arguments.languages:
        stanza.download(
            language,
            processors=PROCESSORS[language],
            package=None,
            model_dir=arguments.model_dir,
            verbose=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
