from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import sys
import time

from bar_triplets_symbolic.core import extract_supported_triplets
from bar_triplets_symbolic.engines import make_engine
from bar_triplets_symbolic.io import load_input
from bar_triplets_symbolic.schema import dataclass_dict


def process_memory_mib() -> tuple[float | None, float | None]:
    if os.name == "nt":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("page_fault_count", ctypes.c_ulong),
                ("peak_working_set_size", ctypes.c_size_t),
                ("working_set_size", ctypes.c_size_t),
                ("quota_peak_paged_pool_usage", ctypes.c_size_t),
                ("quota_paged_pool_usage", ctypes.c_size_t),
                ("quota_peak_non_paged_pool_usage", ctypes.c_size_t),
                ("quota_non_paged_pool_usage", ctypes.c_size_t),
                ("pagefile_usage", ctypes.c_size_t),
                ("peak_pagefile_usage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
        psapi.GetProcessMemoryInfo.restype = ctypes.c_int
        handle = kernel32.GetCurrentProcess()
        if psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            divisor = 1024 * 1024
            return round(counters.working_set_size / divisor, 1), round(counters.peak_working_set_size / divisor, 1)
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        divisor = 1024 if sys.platform != "darwin" else 1024 * 1024
        return None, round(peak / divisor, 1)
    except (ImportError, OSError):
        return None, None


def main() -> int:
    parser = argparse.ArgumentParser(description="BAR deterministic semantic-triplet experiment")
    parser.add_argument("input", help="JSON corpus with semantic entities and sentences")
    parser.add_argument("--engine", choices=("spacy", "stanza"), required=True)
    parser.add_argument("--model", help="Override the engine model/package")
    parser.add_argument("--output", help="Write JSON result to this path")
    arguments = parser.parse_args()

    language, documents, entities, min_support = load_input(arguments.input)
    started = time.perf_counter()
    engine = make_engine(arguments.engine, language, arguments.model)
    loaded = time.perf_counter()
    model_working_set, model_peak_working_set = process_memory_mib()
    relations, meta = extract_supported_triplets(engine, documents, entities, min_support)
    finished = time.perf_counter()
    final_working_set, final_peak_working_set = process_memory_mib()

    payload = {
        "engine": engine.name,
        "engine_version": engine.version,
        "model": engine.model_name,
        "language": language,
        "relations": [dataclass_dict(value) for value in relations],
        "meta": {
            **meta,
            "model_load_ms": round((loaded - started) * 1000, 1),
            "analysis_ms": round((finished - loaded) * 1000, 1),
            "model_working_set_mib": model_working_set,
            "model_peak_working_set_mib": model_peak_working_set,
            "final_working_set_mib": final_working_set,
            "final_peak_working_set_mib": final_peak_working_set,
        },
    }
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    if arguments.output:
        Path(arguments.output).write_text(serialized + "\n", encoding="utf-8")
    else:
        print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
