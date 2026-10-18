"""
Measure how often the DistilBERT question classifier agrees with LLM-labelled questions,
and print per-class precision/recall/F1 plus a confusion matrix.

IMPORTANT: the "ground truth" is Gemini's label, not a human annotation. Report this as
"agreement with an LLM-labelled test set", not as absolute accuracy.

Usage
  # Ask Gemini for questions of each type for several roles, classify them, report
  python eval_classifier.py --generate 6                # 6 questions per label per role
  python eval_classifier.py --generate 6 --all-labels   # also Competency and Culture Fit

  # Report on pairs logged by the API (start the server with LOG_CLASSIFIER_EVAL=1)
  python eval_classifier.py --log classifier_eval_log.jsonl

Writes classifier_eval_report.json next to the script.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from typing import Iterable

LABELS = ["Behavioral", "Technical", "Situational", "Competency", "Culture Fit"]
APP_LABELS = ["Technical", "Behavioral", "Situational"]  # what the app generates

ROLES = [
    "Machine Learning Engineer", "Backend Engineer", "Frontend Engineer", "Data Analyst",
    "DevOps Engineer", "Data Scientist", "Full Stack Developer", "Product Manager",
    "QA Engineer", "Mobile Developer", "Cloud Engineer", "Software Engineer (fresher)",
]

LABEL_HELP = {
    "Behavioral": "asks about a specific PAST experience (\"Tell me about a time you...\")",
    "Technical": "tests knowledge of a tool, concept, algorithm or design",
    "Situational": "a HYPOTHETICAL scenario (\"What would you do if...\")",
    "Competency": "asks how the candidate applies a skill such as prioritisation or communication",
    "Culture Fit": "asks about values, motivation, work style or why this company",
}


def compute_metrics(pairs: Iterable[tuple[str, str]]) -> dict:
    """pairs = (expected, predicted)."""
    pairs = list(pairs)
    n = len(pairs)
    confusion: dict[str, Counter] = defaultdict(Counter)
    for expected, predicted in pairs:
        confusion[expected][predicted] += 1

    labels = [l for l in LABELS if any(l == e or l == p for e, p in pairs)]
    per_class = {}
    for label in labels:
        tp = confusion[label][label]
        fp = sum(confusion[e][label] for e in confusion if e != label)
        fn = sum(c for p, c in confusion[label].items() if p != label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[label] = {"precision": precision, "recall": recall, "f1": f1,
                            "support": sum(confusion[label].values())}
    expected_labels = [l for l in labels if per_class[l]["support"] > 0]
    macro_f1 = (sum(per_class[l]["f1"] for l in expected_labels) / len(expected_labels)) if expected_labels else 0.0
    correct = sum(1 for e, p in pairs if e == p)
    return {
        "n": n,
        "accuracy": correct / n if n else 0.0,
        "macro_f1": macro_f1,
        "per_class": per_class,
        "confusion": {e: dict(c) for e, c in confusion.items()},
        "labels": labels,
    }


def format_report(m: dict) -> str:
    lines = [f"Samples: {m['n']}   Agreement (accuracy): {m['accuracy']:.1%}   Macro F1: {m['macro_f1']:.3f}", ""]
    lines.append(f"{'label':<13}{'precision':>10}{'recall':>9}{'f1':>7}{'support':>9}")
    for label, s in m["per_class"].items():
        lines.append(f"{label:<13}{s['precision']:>10.2f}{s['recall']:>9.2f}{s['f1']:>7.2f}{s['support']:>9}")
    lines += ["", "Confusion matrix (rows = LLM label, columns = classifier prediction)"]
    labels = m["labels"]
    lines.append(f"{'':<13}" + "".join(f"{l[:11]:>12}" for l in labels))
    for e in labels:
        row = m["confusion"].get(e)
        if row is None:
            continue
        lines.append(f"{e:<13}" + "".join(f"{row.get(p, 0):>12}" for p in labels))
    return "\n".join(lines)


def read_log(path: str) -> list[tuple[str, str]]:
    pairs = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                row = json.loads(line)
                pairs.append((row["expected"], row["predicted"]))
    return pairs


def generate_pairs(per_label: int, labels: list[str]) -> list[tuple[str, str]]:
    # Imported lazily so the metric functions above work without torch / API keys
    from typing import Literal

    from pydantic import BaseModel

    import main

    class Item(BaseModel):
        question: str
        label: Literal["Behavioral", "Technical", "Situational", "Competency", "Culture Fit"]

    class Batch(BaseModel):
        items: list[Item]

    if not main.CLASSIFIER_AVAILABLE:
        sys.exit("Classifier is not loaded (check HF_TOKEN / model download / DISABLE_CLASSIFIER).")

    help_text = "\n".join(f"- {l}: {LABEL_HELP[l]}" for l in labels)
    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    for role in ROLES:
        prompt = (
            f"Write interview questions for a {role} role: exactly {per_label} per label.\n"
            f"Labels:\n{help_text}\n"
            "Make each question realistic, specific and different from the others. "
            "Use only the labels listed above."
        )
        try:
            batch: Batch = main.call_gemini_json(prompt, Batch, temperature=1.0)
        except Exception as e:  # keep going if one role fails
            print(f"  skipped {role}: {e}")
            continue
        for item in batch.items:
            if item.label not in labels or item.question in seen:
                continue
            seen.add(item.question)
            pred = main.classify_question(item.question)
            if pred:
                pairs.append((item.label, pred["category"]))
        print(f"  {role}: {len(pairs)} labelled questions so far")
    return pairs


def main_cli():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--generate", type=int, metavar="N", help="questions per label per role to generate with Gemini")
    ap.add_argument("--all-labels", action="store_true", help="also generate Competency and Culture Fit")
    ap.add_argument("--log", metavar="FILE", help="evaluate pairs logged by the API")
    args = ap.parse_args()

    if args.log:
        pairs = read_log(args.log)
    elif args.generate:
        pairs = generate_pairs(args.generate, LABELS if args.all_labels else APP_LABELS)
    else:
        ap.error("pass --generate N or --log FILE")

    if not pairs:
        sys.exit("No labelled pairs to evaluate.")
    metrics = compute_metrics(pairs)
    print("\n" + format_report(metrics))
    with open("classifier_eval_report.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print("\nSaved classifier_eval_report.json")


if __name__ == "__main__":
    main_cli()