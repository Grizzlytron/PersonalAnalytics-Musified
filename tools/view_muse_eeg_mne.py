#!/usr/bin/env python3
"""Load Muse EEG data from PersonalAnalytics SQLite and view it in MNE.

This script reads aggregated Muse EEG values from the `muse_data` table
(channel1_TP9, channel2_AF7, channel3_AF8, channel4_TP10), converts them
to an MNE Raw object, and opens the interactive EEG browser.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path
from typing import Optional

import mne
import numpy as np
import pandas as pd


DEFAULT_DB_CANDIDATES = [
    Path.home() / "AppData" / "Roaming" / "muselytics" / "database.sqlite",
    Path.home() / "AppData" / "Roaming" / "personal-analytics" / "database.sqlite",
]

EEG_COLUMNS = [
    "channel1_TP9",
    "channel2_AF7",
    "channel3_AF8",
    "channel4_TP10",
]
EEG_NAMES = ["TP9", "AF7", "AF8", "TP10"]


def _rolling_mean(signal: np.ndarray, window: int) -> np.ndarray:
    if window <= 1:
        return signal.copy()
    kernel = np.ones(window, dtype=float) / float(window)
    return np.convolve(signal, kernel, mode="same")


def print_blink_helper(
    df: pd.DataFrame,
    sfreq: float,
    threshold_uv: Optional[float],
    min_distance_ms: int,
    max_events: int,
) -> None:
    if len(df) < 10:
        print("\n[Blink helper] Not enough samples for event detection.")
        return

    af7 = df["channel2_AF7"].to_numpy(dtype=float)
    af8 = df["channel3_AF8"].to_numpy(dtype=float)
    tp9 = df["channel1_TP9"].to_numpy(dtype=float)
    tp10 = df["channel4_TP10"].to_numpy(dtype=float)

    frontal_abs = np.maximum(np.abs(af7), np.abs(af8))

    # Remove slow drifts to emphasize short blink-like transients.
    hp_window = max(3, int(round(sfreq * 0.25)))
    frontal_hp = frontal_abs - _rolling_mean(frontal_abs, hp_window)
    frontal_hp = np.maximum(frontal_hp, 0.0)

    if threshold_uv is None:
        med = float(np.median(frontal_hp))
        mad = float(np.median(np.abs(frontal_hp - med)))
        threshold_uv = med + 6.0 * (mad if mad > 1e-9 else 1.0)

    candidate_idx = np.where(frontal_hp >= threshold_uv)[0]
    if candidate_idx.size == 0:
        print("\n[Blink helper] No blink-like events found with current threshold.")
        print(f"Threshold used: {threshold_uv:.2f} uV")
        return

    min_distance_samples = max(1, int(round((min_distance_ms / 1000.0) * sfreq)))

    # Keep local maxima and enforce minimum distance between events.
    selected: list[int] = []
    for idx in candidate_idx:
        left = max(0, idx - 1)
        right = min(len(frontal_hp) - 1, idx + 1)
        if not (frontal_hp[idx] >= frontal_hp[left] and frontal_hp[idx] >= frontal_hp[right]):
            continue
        if selected and (idx - selected[-1]) < min_distance_samples:
            if frontal_hp[idx] > frontal_hp[selected[-1]]:
                selected[-1] = int(idx)
            continue
        selected.append(int(idx))

    if not selected:
        print("\n[Blink helper] No separated events after distance filtering.")
        print(f"Threshold used: {threshold_uv:.2f} uV")
        return

    events = selected[: max_events if max_events > 0 else len(selected)]
    half_window = max(1, int(round(sfreq * 0.20)))

    print("\n[Blink helper] Blink-like event summary")
    print(f"Threshold: {threshold_uv:.2f} uV | Min distance: {min_distance_ms} ms")
    print("Time                AF7pk  AF8pk  TP9pk  TP10pk  Frontal/TP  Dominant")

    for idx in events:
        lo = max(0, idx - half_window)
        hi = min(len(df) - 1, idx + half_window)

        af7_pk = float(np.max(np.abs(af7[lo : hi + 1])))
        af8_pk = float(np.max(np.abs(af8[lo : hi + 1])))
        tp9_pk = float(np.max(np.abs(tp9[lo : hi + 1])))
        tp10_pk = float(np.max(np.abs(tp10[lo : hi + 1])))

        frontal_pk = max(af7_pk, af8_pk)
        tp_pk = max(tp9_pk, tp10_pk)
        ratio = frontal_pk / tp_pk if tp_pk > 1e-9 else np.nan

        dominant = max(
            [("AF7", af7_pk), ("AF8", af8_pk), ("TP9", tp9_pk), ("TP10", tp10_pk)],
            key=lambda x: x[1],
        )[0]

        ts = pd.Timestamp(df.iloc[idx]["timestamp"]).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        ratio_txt = f"{ratio:>9.2f}" if np.isfinite(ratio) else "      n/a"
        print(
            f"{ts}  {af7_pk:5.1f}  {af8_pk:5.1f}  {tp9_pk:5.1f}  {tp10_pk:6.1f}  {ratio_txt}  {dominant}"
        )

    if len(selected) > len(events):
        print(f"... {len(selected) - len(events)} more events omitted (increase --blink-max-events).")


def find_database(explicit_path: Optional[str]) -> Path:
    if explicit_path:
        db_path = Path(explicit_path).expanduser()
        if not db_path.exists():
            raise FileNotFoundError(f"Database not found: {db_path}")
        return db_path

    for candidate in DEFAULT_DB_CANDIDATES:
        if candidate.exists():
            return candidate

    candidates_str = "\n".join(f"- {p}" for p in DEFAULT_DB_CANDIDATES)
    raise FileNotFoundError(
        "Could not find a PersonalAnalytics database automatically. "
        "Use --db-path. Checked:\n"
        f"{candidates_str}"
    )


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1", (table_name,)
    )
    return cursor.fetchone() is not None


def load_muse_eeg(db_path: Path, start: Optional[str], end: Optional[str]) -> tuple[pd.DataFrame, str]:
    where_parts = []
    params: list[str] = []

    if start:
        where_parts.append("timestamp >= ?")
        params.append(start)
    if end:
        where_parts.append("timestamp <= ?")
        params.append(end)

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    with sqlite3.connect(db_path) as conn:
        if table_exists(conn, "muse_raw_eeg"):
            query = f"""
                SELECT
                    timestamp,
                    tp9 AS channel1_TP9,
                    af7 AS channel2_AF7,
                    af8 AS channel3_AF8,
                    tp10 AS channel4_TP10
                FROM muse_raw_eeg
                {where_sql}
                ORDER BY timestamp ASC
            """
            df = pd.read_sql_query(query, conn, params=params)
            source = "muse_raw_eeg"
        else:
            query = f"""
                SELECT
                    timestamp,
                    channel1_TP9,
                    channel2_AF7,
                    channel3_AF8,
                    channel4_TP10
                FROM muse_data
                {where_sql}
                ORDER BY timestamp ASC
            """
            df = pd.read_sql_query(query, conn, params=params)
            source = "muse_data"

    if df.empty:
        raise ValueError("No Muse EEG rows found for the selected range.")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"]).copy()

    for col in EEG_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Keep only rows with at least one valid EEG value.
    df = df.dropna(subset=EEG_COLUMNS, how="all").reset_index(drop=True)

    if df.empty:
        raise ValueError("No valid EEG numeric values found in muse_data.")

    return df, source


def estimate_sampling_rate(timestamps: pd.Series) -> float:
    if len(timestamps) < 2:
        return 0.2  # Fallback: one sample every 5 seconds

    deltas = timestamps.diff().dt.total_seconds().dropna()
    deltas = deltas[deltas > 0]
    if deltas.empty:
        return 0.2

    median_delta = float(deltas.median())
    if median_delta <= 0:
        return 0.2

    return 1.0 / median_delta


def make_raw(df: pd.DataFrame) -> mne.io.RawArray:
    sfreq = estimate_sampling_rate(df["timestamp"])

    # PersonalAnalytics stores these channel values in microvolts.
    data_uv = df[EEG_COLUMNS].to_numpy(dtype=float)
    data_uv = np.nan_to_num(data_uv, nan=0.0)
    data_v = data_uv * 1e-6

    info = mne.create_info(ch_names=EEG_NAMES, sfreq=sfreq, ch_types=["eeg"] * len(EEG_NAMES))
    raw = mne.io.RawArray(data_v.T, info)

    # Attach a standard montage for familiar channel positioning.
    montage = mne.channels.make_standard_montage("standard_1020")
    raw.set_montage(montage, on_missing="warn")

    return raw


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Open Muse EEG from PersonalAnalytics in the MNE EEG browser."
    )
    parser.add_argument(
        "--db-path",
        type=str,
        default=None,
        help="Path to database.sqlite (auto-detected if omitted)",
    )
    parser.add_argument(
        "--start",
        type=str,
        default=None,
        help="Optional start timestamp (e.g., '2026-03-15 09:00:00')",
    )
    parser.add_argument(
        "--end",
        type=str,
        default=None,
        help="Optional end timestamp (e.g., '2026-03-15 12:00:00')",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=300.0,
        help="Seconds shown per page in the browser (default: 300)",
    )
    parser.add_argument(
        "--scaling-uv",
        type=float,
        default=120.0,
        help=(
            "Amplitude scaling in microvolts for EEG display "
            "(higher value = visually flatter signals, default: 120)"
        ),
    )
    parser.add_argument(
        "--save-fif",
        type=str,
        default=None,
        help="Optional output path to save as .fif before plotting",
    )
    parser.add_argument(
        "--browser-backend",
        type=str,
        choices=["auto", "qt", "matplotlib"],
        default="auto",
        help=(
            "MNE browser backend. 'auto' prefers qt (better DPI/layout on Windows) "
            "and falls back to matplotlib."
        ),
    )
    parser.add_argument(
        "--no-plot",
        action="store_true",
        help="Load and optionally save data, but do not open the interactive EEG viewer",
    )
    parser.add_argument(
        "--blink-helper",
        action="store_true",
        help="Print blink-like event diagnostics with per-channel peak comparisons",
    )
    parser.add_argument(
        "--blink-threshold-uv",
        type=float,
        default=None,
        help="Optional fixed blink threshold in microvolts (auto if omitted)",
    )
    parser.add_argument(
        "--blink-min-distance-ms",
        type=int,
        default=250,
        help="Minimum distance between detected events in milliseconds (default: 250)",
    )
    parser.add_argument(
        "--blink-max-events",
        type=int,
        default=30,
        help="Maximum number of events printed by helper (default: 30)",
    )
    parser.add_argument(
        "--blink-last-seconds",
        type=float,
        default=None,
        help="If set, run blink helper only on the last N seconds of data",
    )

    args = parser.parse_args()

    db_path = find_database(args.db_path)
    df, source = load_muse_eeg(db_path, start=args.start, end=args.end)
    raw = make_raw(df)

    print(f"Using database: {db_path}")
    print(f"Source table: {source}")
    print(f"Loaded samples: {len(df)}")
    print(f"Estimated sampling rate: {raw.info['sfreq']:.4f} Hz")
    print("Channels:", ", ".join(raw.ch_names))
    print()
    print("Viewer tips:")
    print("- Increase --duration to zoom out in time (see more seconds at once).")
    print("- Increase --scaling-uv to zoom out in amplitude (flatter traces).")
    print("- Example: --duration 900 --scaling-uv 200")

    if args.blink_helper:
        blink_df = df
        if args.blink_last_seconds is not None and args.blink_last_seconds > 0:
            end_ts = df["timestamp"].max()
            start_ts = end_ts - pd.to_timedelta(args.blink_last_seconds, unit="s")
            blink_df = df[df["timestamp"] >= start_ts].reset_index(drop=True)
            print(
                f"[Blink helper] Using only last {args.blink_last_seconds:.1f}s "
                f"({len(blink_df)} samples)"
            )

        print_blink_helper(
            blink_df,
            float(raw.info["sfreq"]),
            threshold_uv=args.blink_threshold_uv,
            min_distance_ms=args.blink_min_distance_ms,
            max_events=args.blink_max_events,
        )

    if args.save_fif:
        output = Path(args.save_fif).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        raw.save(output, overwrite=True)
        print(f"Saved FIF: {output}")

    if args.no_plot:
        return

    # Backend selection affects UI scaling/layout behavior.
    backend_used = None
    if args.browser_backend == "auto":
        for candidate in ("qt", "matplotlib"):
            try:
                mne.viz.set_browser_backend(candidate)
                backend_used = candidate
                break
            except Exception:
                continue
    else:
        try:
            mne.viz.set_browser_backend(args.browser_backend)
            backend_used = args.browser_backend
        except Exception as exc:
            print(f"Warning: failed to set browser backend '{args.browser_backend}': {exc}")

    if backend_used:
        print(f"Browser backend: {backend_used}")

    raw.plot(
        duration=args.duration,
        n_channels=len(raw.ch_names),
        scalings={"eeg": args.scaling_uv * 1e-6},
        title="Muse EEG (PersonalAnalytics)",
        show=True,
        block=True,
    )


if __name__ == "__main__":
    main()
