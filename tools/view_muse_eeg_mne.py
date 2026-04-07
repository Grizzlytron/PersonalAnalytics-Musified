#!/usr/bin/env python3
"""Load Muse EEG data from PersonalAnalytics SQLite and view it in MNE.

This script reads aggregated Muse EEG values from the `muse_data` table
(channel1_TP9, channel2_AF7, channel3_AF8, channel4_TP10), converts them
to an MNE Raw object, and opens the interactive EEG browser.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
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
DEFAULT_SFREQ_HZ = 256.0


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


def make_raw(df: pd.DataFrame, sfreq_hz: float) -> mne.io.RawArray:
    if sfreq_hz <= 0:
        raise ValueError("Sampling rate must be > 0 Hz")

    # PersonalAnalytics stores these channel values in microvolts.
    data_uv = df[EEG_COLUMNS].to_numpy(dtype=float)
    data_uv = np.nan_to_num(data_uv, nan=0.0)
    data_v = data_uv * 1e-6

    info = mne.create_info(ch_names=EEG_NAMES, sfreq=sfreq_hz, ch_types=["eeg"] * len(EEG_NAMES))
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
        "--sfreq",
        type=float,
        default=DEFAULT_SFREQ_HZ,
        help="Fixed EEG sampling rate in Hz used for timeline conversion (default: 256)",
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
        "--highpass-hz",
        type=float,
        default=1.0,
        help=(
            "High-pass cutoff in Hz applied before plotting (default: 1.0). "
            "Set <= 0 to disable."
        ),
    )
    parser.add_argument(
        "--notch-hz",
        type=float,
        default=50.0,
        help=(
            "Notch center frequency in Hz applied before plotting (default: 50.0, Europe). "
            "Set <= 0 to disable."
        ),
    )
    parser.add_argument(
        "--window-width",
        type=int,
        default=1700,
        help="Initial plot window width in pixels (default: 1700)",
    )
    parser.add_argument(
        "--window-height",
        type=int,
        default=980,
        help="Initial plot window height in pixels (default: 980)",
    )
    parser.add_argument(
        "--browser-backend",
        type=str,
        choices=["auto", "qt", "matplotlib"],
        default="matplotlib",
        help=(
            "MNE browser backend. Default is matplotlib for reliable full-window layout "
            "on Windows. 'auto' picks a sensible backend per platform."
        ),
    )
    parser.add_argument(
        "--no-plot",
        action="store_true",
        help="Load and optionally save data, but do not open the interactive EEG viewer",
    )

    args = parser.parse_args()

    db_path = find_database(args.db_path)
    df, source = load_muse_eeg(db_path, start=args.start, end=args.end)
    raw = make_raw(df, sfreq_hz=args.sfreq)

    sfreq = float(raw.info["sfreq"])
    nyquist = sfreq / 2.0

    if args.highpass_hz and args.highpass_hz > 0:
        if args.highpass_hz >= nyquist:
            print(
                f"Warning: skipping high-pass at {args.highpass_hz:.2f} Hz because Nyquist is {nyquist:.2f} Hz"
            )
        else:
            raw.filter(l_freq=args.highpass_hz, h_freq=None, picks="eeg", verbose=False)

    if args.notch_hz and args.notch_hz > 0:
        if args.notch_hz >= nyquist:
            print(
                f"Warning: skipping notch at {args.notch_hz:.2f} Hz because Nyquist is {nyquist:.2f} Hz"
            )
        else:
            raw.notch_filter(freqs=[args.notch_hz], picks="eeg", verbose=False)

    print(f"Using database: {db_path}")
    print(f"Source table: {source}")
    print(f"Loaded samples: {len(df)}")
    print(f"Sampling rate (fixed): {raw.info['sfreq']:.4f} Hz")
    print("Channels:", ", ".join(raw.ch_names))
    print(f"High-pass: {args.highpass_hz:.2f} Hz" if args.highpass_hz > 0 else "High-pass: disabled")
    print(f"Notch: {args.notch_hz:.2f} Hz" if args.notch_hz > 0 else "Notch: disabled")
    print()
    print("Viewer tips:")
    print("- Increase --duration to zoom out in time (see more seconds at once).")
    print("- Increase --scaling-uv to zoom out in amplitude (flatter traces).")
    print("- Example: --duration 900 --scaling-uv 200")

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
        candidates = ("matplotlib", "qt") if sys.platform.startswith("win") else ("qt", "matplotlib")
        for candidate in candidates:
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

    width_in = max(8.0, args.window_width / 100.0)
    height_in = max(5.5, args.window_height / 100.0)

    use_matplotlib = backend_used == "matplotlib"

    browser = raw.plot(
        duration=args.duration,
        n_channels=len(raw.ch_names),
        scalings={"eeg": args.scaling_uv * 1e-6},
        title="Muse EEG (PersonalAnalytics)",
        show_scrollbars=True,
        show_scalebars=True,
        splash=False,
        show=True,
        block=not use_matplotlib,
    )

    # On some Windows DPI/font settings the bottom axis label can be clipped;
    # enforce extra bottom margin when running the matplotlib browser.
    if backend_used == "matplotlib":
        fig = None
        if hasattr(browser, "subplots_adjust"):
            fig = browser
        elif hasattr(browser, "fig"):
            fig = browser.fig
        elif hasattr(browser, "mne") and hasattr(browser.mne, "fig"):
            fig = browser.mne.fig

        if fig is not None:
            if hasattr(fig, "set_size_inches"):
                fig.set_size_inches(width_in, height_in, forward=True)

        if fig is not None and hasattr(fig, "subplots_adjust"):
            fig.subplots_adjust(left=0.06, right=0.995, top=0.97, bottom=0.12)
            if hasattr(fig, "canvas") and hasattr(fig.canvas, "draw_idle"):
                fig.canvas.draw_idle()

        # For matplotlib, block after the layout fix is applied.
        import matplotlib.pyplot as plt

        plt.show(block=True)


if __name__ == "__main__":
    main()
