"""
Emit unconstrained build counts from Norrinir's simc-talent-generator.

Usage:
    python3 norrinir_counts.py <talents.json> <generate_talents.py>

Outputs JSON to stdout:
    {"Shaman Enhancement": {"class": 121810220978, "spec": ..., "hero": ...}, ...}
"""

import importlib.util
import json
import sys


def load_module(path: str, name: str = "generate_talents"):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    talents_json_path = sys.argv[1]
    script_path = sys.argv[2]

    mod = load_module(script_path)
    talents = mod.TalentJSON.from_file(talents_json_path)

    result = {}
    for (class_name, spec_name), specialization in talents.table.items():
        key = f"{class_name} {spec_name}"
        result[key] = {
            "class": specialization.class_.count_builds(),
            "spec": specialization.spec.count_builds(),
            "hero": specialization.hero.count_builds(),
        }

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
