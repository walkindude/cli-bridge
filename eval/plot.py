"""Render cost/token plots for the cli-bridge eval runs.

Reads per-task.csv from sonnet-full/ and haiku-spike/, writes PNGs into
results/plots/.

Run with: /tmp/bench-plots-venv/bin/python3 eval/plot.py
"""

import csv
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).resolve().parent
RUNS = {
    "Sonnet 4.6": HERE / "results" / "sonnet-full",
    "Haiku 4.5":  HERE / "results" / "haiku-spike",
}
PLOTS_DIR = HERE / "results" / "plots"
PLOTS_DIR.mkdir(parents=True, exist_ok=True)

# Short labels for per-task axis.
TASK_LABELS = {
    "t01_callers":       "callers",
    "t02_blast_radius":  "blast-radius",
    "t03_implementors":  "implementors",
    "t04_callees":       "callees",
    "t05_references":    "references",
    "t06_dead":          "dead",
    "t07_find_by_file":  "find (by file)",
    "t08_def":           "def",
    "t10_health":        "health",
}
TASK_ORDER = list(TASK_LABELS.keys())

CONTROL_COLOR = "#d62728"   # red — grep/agent fallback
TREATMENT_COLOR = "#2ca02c" # green — cli-bridge MCP


def load(run_dir: Path):
    rows = list(csv.DictReader((run_dir / "per-task.csv").open()))
    for r in rows:
        r["cost"] = float(r["cost_usd"])
        r["input_tokens"] = int(r["input_tokens"])
        r["output_tokens"] = int(r["output_tokens"])
        r["tokens"] = r["input_tokens"] + r["output_tokens"]
        r["correct"] = r["correct"] == "true"
        r["primary_is_gold"] = r["primary_is_gold"] == "true"
        r["fell_back_to_grep"] = r["fell_back_to_grep"] == "true"
    return rows


def aggregate(rows):
    """Per-arm and per-task aggregates."""
    by_arm = defaultdict(list)
    by_arm_task = defaultdict(list)
    for r in rows:
        by_arm[r["treatment"]].append(r)
        by_arm_task[(r["treatment"], r["task_id"])].append(r)

    arm_totals = {}
    for arm, rs in by_arm.items():
        arm_totals[arm] = {
            "n":                len(rs),
            "total_cost":       sum(r["cost"] for r in rs),
            "median_tokens":    statistics.median(r["tokens"] for r in rs),
            "correct_pct":      100 * sum(1 for r in rs if r["correct"]) / len(rs),
            "primary_gold_pct": 100 * sum(1 for r in rs if r["primary_is_gold"]) / len(rs),
            "grep_fb_pct":      100 * sum(1 for r in rs if r["fell_back_to_grep"]) / len(rs),
        }
    per_task = {}
    for (arm, task), rs in by_arm_task.items():
        per_task[(arm, task)] = {
            "cost":          sum(r["cost"] for r in rs),
            "median_tokens": statistics.median(r["tokens"] for r in rs),
        }
    return arm_totals, per_task


def bar_with_labels(ax, labels, values, colors, *, fmt="{:.2f}", headroom=1.2):
    bars = ax.bar(labels, values, color=colors, edgecolor="white", linewidth=0.5)
    ymax = max(values) if values else 1
    for bar, v in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + ymax * 0.02,
            fmt.format(v),
            ha="center", va="bottom", fontsize=9,
        )
    ax.set_ylim(0, ymax * headroom)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", linestyle=":", linewidth=0.5, alpha=0.5)
    ax.set_axisbelow(True)


def panel_total_cost(ax, arm_totals, *, model, trials_per_cell):
    control = arm_totals["control"]
    treatment = arm_totals["treatment"]
    delta_pct = 100 * (treatment["total_cost"] - control["total_cost"]) / control["total_cost"]
    labels = ["control\n(grep + Bash)", "treatment\n(cli-bridge MCP)"]
    values = [control["total_cost"], treatment["total_cost"]]
    bar_with_labels(ax, labels, values, [CONTROL_COLOR, TREATMENT_COLOR],
                    fmt="${:.2f}")
    ax.set_ylabel("total $ across all trials", fontsize=9)
    ax.set_title(f"{model} — total cost  ({delta_pct:+.0f}%)", fontsize=11, fontweight="bold", pad=6)
    ax.tick_params(axis="x", labelsize=9)


def panel_per_task_cost(ax, per_task, *, model):
    x = np.arange(len(TASK_ORDER))
    width = 0.38
    control = [per_task[("control", t)]["cost"] for t in TASK_ORDER]
    treatment = [per_task[("treatment", t)]["cost"] for t in TASK_ORDER]
    ax.bar(x - width / 2, control, width, label="control", color=CONTROL_COLOR, edgecolor="white", linewidth=0.3)
    ax.bar(x + width / 2, treatment, width, label="treatment", color=TREATMENT_COLOR, edgecolor="white", linewidth=0.3)
    ax.set_xticks(x)
    ax.set_xticklabels([TASK_LABELS[t] for t in TASK_ORDER], rotation=30, ha="right", fontsize=8)
    ax.set_ylabel("cost per task ($)", fontsize=9)
    ax.set_title(f"{model} — cost per task", fontsize=11, fontweight="bold", pad=6)
    ax.legend(fontsize=8, frameon=False, loc="upper right")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", linestyle=":", linewidth=0.5, alpha=0.5)
    ax.set_axisbelow(True)


def panel_rates(ax, arm_totals, *, model):
    metrics = [
        ("correct",      "correct_pct"),
        ("primary=gold", "primary_gold_pct"),
        ("grep fallback","grep_fb_pct"),
    ]
    x = np.arange(len(metrics))
    width = 0.38
    control = [arm_totals["control"][k] for _, k in metrics]
    treatment = [arm_totals["treatment"][k] for _, k in metrics]
    ax.bar(x - width / 2, control, width, label="control", color=CONTROL_COLOR, edgecolor="white", linewidth=0.3)
    ax.bar(x + width / 2, treatment, width, label="treatment", color=TREATMENT_COLOR, edgecolor="white", linewidth=0.3)
    for i, (c, t) in enumerate(zip(control, treatment)):
        ax.text(i - width / 2, c + 2, f"{c:.0f}%", ha="center", va="bottom", fontsize=8)
        ax.text(i + width / 2, t + 2, f"{t:.0f}%", ha="center", va="bottom", fontsize=8)
    ax.set_xticks(x)
    ax.set_xticklabels([m[0] for m in metrics], fontsize=9)
    ax.set_ylabel("%", fontsize=9)
    ax.set_title(f"{model} — key rates", fontsize=11, fontweight="bold", pad=6)
    ax.set_ylim(0, 115)
    ax.legend(fontsize=8, frameon=False, loc="upper right")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", linestyle=":", linewidth=0.5, alpha=0.5)
    ax.set_axisbelow(True)


def make_dashboard(data, out_path: Path):
    fig, axes = plt.subplots(2, 3, figsize=(16, 9))
    fig.patch.set_facecolor("white")
    for row_idx, (model, entry) in enumerate(data.items()):
        panel_total_cost(axes[row_idx][0], entry["arm_totals"], model=model,
                         trials_per_cell=entry["trials_per_cell"])
        panel_per_task_cost(axes[row_idx][1], entry["per_task"], model=model)
        panel_rates(axes[row_idx][2], entry["arm_totals"], model=model)

    fig.suptitle("cli-bridge eval — gosymdb as test vehicle on gin-gonic/gin",
                 fontsize=14, fontweight="bold", y=0.995)
    subtitle = (
        "9 tasks × 2 arms · treatment = cli-bridge MCP loaded · control = Bash/Grep/Read only · "
        "isolated trials (no CLAUDE.md, no skills, no session persistence)"
    )
    fig.text(0.5, 0.965, subtitle, ha="center", va="top", fontsize=9, color="#555")
    plt.tight_layout(rect=(0, 0, 1, 0.955))
    fig.savefig(out_path, dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"wrote {out_path}")


def make_hero(data, out_path: Path):
    """Minimal cost-only hero: 2 models × 2 arms = 4 bars."""
    fig, ax = plt.subplots(figsize=(9, 5.5))
    fig.patch.set_facecolor("white")
    labels = []
    values = []
    colors = []
    for model, entry in data.items():
        c = entry["arm_totals"]["control"]["total_cost"]
        t = entry["arm_totals"]["treatment"]["total_cost"]
        delta_pct = 100 * (t - c) / c
        labels.extend([f"{model}\ncontrol", f"{model}\ntreatment\n({delta_pct:+.0f}%)"])
        values.extend([c, t])
        colors.extend([CONTROL_COLOR, TREATMENT_COLOR])

    bars = ax.bar(labels, values, color=colors, edgecolor="white", linewidth=0.5)
    for bar, v in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(values) * 0.02,
                f"${v:.2f}", ha="center", va="bottom", fontsize=10, fontweight="bold")

    ax.set_ylabel("total $ across all trials", fontsize=10)
    ax.set_ylim(0, max(values) * 1.2)
    ax.set_title("cli-bridge eval — total cost, treatment vs control",
                 fontsize=13, fontweight="bold", pad=10)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", linestyle=":", linewidth=0.5, alpha=0.5)
    ax.set_axisbelow(True)

    fig.text(0.5, 0.92,
             "9 tasks × (3 trials Sonnet / 1 trial Haiku) against gin-gonic/gin · isolated trials",
             ha="center", va="top", fontsize=9, color="#555")
    plt.tight_layout(rect=(0, 0, 1, 0.92))
    fig.savefig(out_path, dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"wrote {out_path}")


def main():
    data = {}
    for model, run_dir in RUNS.items():
        rows = load(run_dir)
        arm_totals, per_task = aggregate(rows)
        trials_per_cell = len([r for r in rows if r["treatment"] == "control" and r["task_id"] == TASK_ORDER[0]])
        data[model] = {
            "arm_totals": arm_totals,
            "per_task": per_task,
            "trials_per_cell": trials_per_cell,
        }
        a = arm_totals
        print(f"{model}: n={a['control']['n']}/arm · control ${a['control']['total_cost']:.4f} · "
              f"treatment ${a['treatment']['total_cost']:.4f} · "
              f"Δ {100*(a['treatment']['total_cost']-a['control']['total_cost'])/a['control']['total_cost']:+.1f}%")
        print(f"   correct: {a['control']['correct_pct']:.0f}% → {a['treatment']['correct_pct']:.0f}%"
              f"   primary=gold: {a['control']['primary_gold_pct']:.0f}% → {a['treatment']['primary_gold_pct']:.0f}%"
              f"   grep fallback: {a['control']['grep_fb_pct']:.0f}% → {a['treatment']['grep_fb_pct']:.0f}%"
              f"   median tokens: {a['control']['median_tokens']:.0f} → {a['treatment']['median_tokens']:.0f}")

    make_dashboard(data, PLOTS_DIR / "dashboard.png")
    make_hero(data, PLOTS_DIR / "hero.png")


if __name__ == "__main__":
    main()
